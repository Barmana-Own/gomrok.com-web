$ErrorActionPreference = 'Stop'

$deployStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$remotePassword = Read-Host 'Remote password' -AsSecureString
$remoteCredential = [System.Management.Automation.PSCredential]::new('Administrator', $remotePassword)
$remoteOptions = New-PSSessionOption -SkipCACheck -SkipCNCheck -SkipRevocationCheck
$remoteSession = $null

$localRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$localDist = Join-Path $localRoot 'client\dist'
$remoteRoot = 'C:\Websites\gomrok.org'
$remoteApp = $null
$remoteAppStage = $null
$remoteAppBackup = $null

if (-not (Test-Path (Join-Path $localDist 'index.html'))) {
  throw 'client/dist is missing. Run npm run build first.'
}

try {
  try {
    $remoteSession = New-PSSession -ComputerName 185.252.86.16 -UseSSL -Port 5986 -Credential $remoteCredential -Authentication Basic -SessionOption $remoteOptions
  } catch {
    $remoteSession = New-PSSession -ComputerName 185.252.86.16 -UseSSL -Port 5986 -Credential $remoteCredential -Authentication Negotiate -SessionOption $remoteOptions
  }

  $remoteFrontend = Invoke-Command -Session $remoteSession -ScriptBlock {
    param($expectedRoot)
    Import-Module WebAdministration
    $site = Get-Website -Name 'gomrok.org' -ErrorAction Stop
    $root = [System.IO.Path]::GetFullPath($expectedRoot).TrimEnd('\')
    $physicalPath = [Environment]::ExpandEnvironmentVariables([string]$site.PhysicalPath)
    $physicalPath = [System.IO.Path]::GetFullPath($physicalPath).TrimEnd('\')
    if (-not $physicalPath.StartsWith($root + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "IIS site physical path is outside the expected Gomrok root: $physicalPath"
    }
    $physicalPath
  } -ArgumentList $remoteRoot

  $remoteFrontend = [string]$remoteFrontend | Select-Object -Last 1
  $remoteApp = Join-Path $remoteFrontend 'app'
  $remoteAppStage = Join-Path $remoteFrontend "app.__new-$deployStamp"
  $remoteAppBackup = Join-Path $remoteFrontend "app.backup-$deployStamp"

  Invoke-Command -Session $remoteSession -ScriptBlock {
    param($stagePath)
    if (Test-Path $stagePath) { Remove-Item -LiteralPath $stagePath -Recurse -Force }
    New-Item -ItemType Directory -Path $stagePath -Force | Out-Null
  } -ArgumentList $remoteAppStage

  Copy-Item -Path (Join-Path $localDist '*') -Destination $remoteAppStage -ToSession $remoteSession -Recurse -Force

  $result = Invoke-Command -Session $remoteSession -ScriptBlock {
    param($appPath, $stagePath, $backupPath, $stamp)
    $ErrorActionPreference = 'Stop'
    if (-not (Test-Path (Join-Path $stagePath 'index.html'))) { throw 'Staged app is missing index.html.' }
    if (-not (Test-Path (Join-Path $stagePath 'manifest.webmanifest'))) { throw 'Staged app is missing manifest.webmanifest.' }
    if (-not (Test-Path (Join-Path $stagePath 'images\registration-steps\identity-verification.png'))) { throw 'Staged registration assets are missing.' }

    if (Test-Path $appPath) { Move-Item -LiteralPath $appPath -Destination $backupPath }
    Move-Item -LiteralPath $stagePath -Destination $appPath

    [pscustomobject]@{
      DeployedAt = $stamp
      AppPath = $appPath
      BackupPath = $backupPath
      IndexBytes = (Get-Item -LiteralPath (Join-Path $appPath 'index.html')).Length
      RegistrationImageCount = @(Get-ChildItem -LiteralPath (Join-Path $appPath 'images\registration-steps') -Filter '*.png' -File).Count
      ManifestStartUrl = (Get-Content -LiteralPath (Join-Path $appPath 'manifest.webmanifest') -Raw | Select-String -Pattern '"start_url":\s*"/app"' -Quiet)
    }
  } -ArgumentList $remoteApp, $remoteAppStage, $remoteAppBackup, $deployStamp

  $result | Format-List | Out-String
} finally {
  if ($remoteSession) { Remove-PSSession $remoteSession }
}
