$ErrorActionPreference = 'Stop'

$remotePassword = Read-Host 'Remote password' -AsSecureString
$remoteCredential = [System.Management.Automation.PSCredential]::new('Administrator', $remotePassword)
$remoteOptions = New-PSSessionOption -SkipCACheck -SkipCNCheck -SkipRevocationCheck -OperationTimeout 30000
$session = $null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$localApp = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'server\src\app.js'

try {
  $session = New-PSSession -ComputerName 185.252.86.16 -UseSSL -Port 5986 -Credential $remoteCredential -Authentication Negotiate -SessionOption $remoteOptions
  $remoteStage = 'C:\Websites\gomrok.org\backend\src\app.js.__new'

  Invoke-Command -Session $session -ScriptBlock {
    param($path)
    if (-not (Test-Path (Split-Path -Parent $path))) { throw 'Remote backend source folder was not found.' }
    if (Test-Path $path) { Remove-Item $path -Force }
  } -ArgumentList $remoteStage

  Copy-Item -Path $localApp -Destination $remoteStage -ToSession $session -Force

  $result = Invoke-Command -Session $session -ScriptBlock {
    param($stagePath, $stampValue)
    $ErrorActionPreference = 'Stop'
    $appPath = 'C:\Websites\gomrok.org\backend\src\app.js'
    $backupPath = "$appPath.before-cors-fix-$stampValue.bak"

    if (-not (Test-Path $stagePath)) { throw 'Staged API file was not copied.' }
    $source = Get-Content $stagePath -Raw
    if ($source -notmatch 'Access-Control-Allow-Methods') { throw 'Staged API file does not contain the preflight fix.' }

    Stop-ScheduledTask -TaskName 'GomrokAppApi' -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    # Stop only the API process owned by this project. Stop-ScheduledTask does
    # not always terminate a child node process that is stuck in a request.
    $apiProcesses = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
      Where-Object { $_.CommandLine -like '*C:\Websites\gomrok.org\backend\src\app.js*' }
    foreach ($apiProcess in $apiProcesses) {
      Stop-Process -Id $apiProcess.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 1
    if (Test-Path $backupPath) { Remove-Item $backupPath -Force }
    Copy-Item $appPath $backupPath -Force
    Move-Item $stagePath $appPath -Force
    Start-ScheduledTask -TaskName 'GomrokAppApi'

    $health = $null
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
      try {
        $health = Invoke-WebRequest -Uri 'http://127.0.0.1:13107/api/health' -UseBasicParsing -TimeoutSec 3
        break
      } catch {
        Start-Sleep -Milliseconds 500
      }
    }
    if (-not $health) { throw 'API did not become healthy after the update.' }

    [pscustomobject]@{
      Status = 'api-updated'
      Health = $health.Content
      Backup = $backupPath
    } | ConvertTo-Json -Compress
  } -ArgumentList $remoteStage, $stamp

  $result
} finally {
  if ($session) { Remove-PSSession $session -ErrorAction SilentlyContinue }
}
