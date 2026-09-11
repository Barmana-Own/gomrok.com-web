$ErrorActionPreference = 'Stop'

$deployStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$remotePassword = Read-Host 'Remote password' -AsSecureString
$remoteCredential = [System.Management.Automation.PSCredential]::new('Administrator', $remotePassword)
$remoteOptions = New-PSSessionOption -SkipCACheck -SkipCNCheck -SkipRevocationCheck
$remoteSession = $null

$localRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$localServer = Join-Path $localRoot 'server'
$remoteRoot = 'C:\Websites\gomrok.org'
$remoteBackend = Join-Path $remoteRoot 'backend'
$remoteStage = Join-Path $remoteRoot "backend.__new-$deployStamp"

if (-not (Test-Path (Join-Path $localServer 'src\app.js'))) {
  throw 'server/src/app.js is missing.'
}

try {
  try {
    $remoteSession = New-PSSession -ComputerName 185.252.86.16 -UseSSL -Port 5986 -Credential $remoteCredential -Authentication Basic -SessionOption $remoteOptions
  } catch {
    $remoteSession = New-PSSession -ComputerName 185.252.86.16 -UseSSL -Port 5986 -Credential $remoteCredential -Authentication Negotiate -SessionOption $remoteOptions
  }

  Invoke-Command -Session $remoteSession -ScriptBlock {
    param($stagePath)
    if (Test-Path -LiteralPath $stagePath) { Remove-Item -LiteralPath $stagePath -Recurse -Force }
    New-Item -ItemType Directory -Path (Join-Path $stagePath 'src') -Force | Out-Null
  } -ArgumentList $remoteStage

  Copy-Item -Path (Join-Path $localServer 'src\*') -Destination (Join-Path $remoteStage 'src') -ToSession $remoteSession -Recurse -Force

  $result = Invoke-Command -Session $remoteSession -ScriptBlock {
    param($backendPath, $stagePath, $stamp)
    $ErrorActionPreference = 'Stop'
    $srcPath = Join-Path $backendPath 'src'
    $srcBackup = Join-Path $backendPath "src.backup-$stamp"
    $taskName = 'GomrokAppApi'
    $started = $false

    if (-not (Test-Path (Join-Path $stagePath 'src\app.js'))) { throw 'Staged backend is missing src/app.js.' }
    if (-not (Test-Path (Join-Path $backendPath '.env'))) { throw 'Existing backend .env is missing; deployment stopped to preserve configuration.' }
    if (-not (Test-Path (Join-Path $backendPath 'node_modules\mysql2'))) { throw 'Existing backend dependencies are missing; deployment stopped.' }

    try {
      $task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
      if ($task.State -eq 'Running') {
        Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        for ($attempt = 0; $attempt -lt 20; $attempt++) {
          $running = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*C:\Websites\gomrok.org\backend\src\app.js*' }
          if (-not $running) { break }
          Start-Sleep -Seconds 1
        }
      }

      Move-Item -LiteralPath $srcPath -Destination $srcBackup
      Move-Item -LiteralPath (Join-Path $stagePath 'src') -Destination $srcPath

      Start-ScheduledTask -TaskName $taskName
      $started = $true
      $health = $null
      for ($attempt = 0; $attempt -lt 30; $attempt++) {
        try {
          $health = (Invoke-WebRequest -Uri 'http://127.0.0.1:13107/api/health' -UseBasicParsing -TimeoutSec 3).Content
          if ($health -match '"ok"\s*:\s*true') { break }
        } catch { }
        Start-Sleep -Seconds 1
      }
      if (-not $health -or $health -notmatch '"ok"\s*:\s*true') { throw "API health check failed after backend restart. Last response: $health" }

      $refreshStatus = 0
      try {
        $refreshResponse = Invoke-WebRequest -Uri 'http://127.0.0.1:13107/api/auth/refresh' -Method Post -ContentType 'application/json' -Body '{"refreshToken":"invalid"}' -UseBasicParsing -TimeoutSec 5
        $refreshStatus = [int]$refreshResponse.StatusCode
      } catch {
        if ($_.Exception.Response) { $refreshStatus = [int]$_.Exception.Response.StatusCode } else { throw }
      }
      if ($refreshStatus -eq 404) { throw 'The deployed API still does not expose /api/auth/refresh.' }

      [pscustomobject]@{
        DeployedAt = $stamp
        BackendPath = $backendPath
        SourceBackupPath = $srcBackup
        ApiHealth = $health
        RefreshRouteStatus = $refreshStatus
      }
    } catch {
      if ($started) { Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue }
      if (Test-Path $srcPath) { Remove-Item -LiteralPath $srcPath -Recurse -Force }
      if (Test-Path $srcBackup) { Move-Item -LiteralPath $srcBackup -Destination $srcPath }
      if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { Start-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue }
      throw
    } finally {
      if (Test-Path $stagePath) { Remove-Item -LiteralPath $stagePath -Recurse -Force -ErrorAction SilentlyContinue }
    }
  } -ArgumentList $remoteBackend, $remoteStage, $deployStamp | Format-List | Out-String
} finally {
  if ($remoteSession) { Remove-PSSession $remoteSession }
}
