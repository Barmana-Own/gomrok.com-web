$ErrorActionPreference = 'Stop'

$deployStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$localRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$localDist = Join-Path $localRoot 'client\dist'
$localArchive = Join-Path ([System.IO.Path]::GetTempPath()) "gomrok-admin-$deployStamp.zip"
$remoteRoot = 'C:\Websites\gomrok.org'
$remoteApp = Join-Path $remoteRoot 'frontend\app'
$remoteStage = Join-Path $remoteRoot 'frontend\app.__new'
$remoteArchive = Join-Path $remoteRoot 'app.__new.zip'
$remotePassword = Read-Host 'Remote password' -AsSecureString
$remoteCredential = [System.Management.Automation.PSCredential]::new('Administrator', $remotePassword)
$remoteOptions = New-PSSessionOption -SkipCACheck -SkipCNCheck -SkipRevocationCheck -OperationTimeout 30000
$remoteSession = $null

try {
  Compress-Archive -Path (Join-Path $localDist '*') -DestinationPath $localArchive -Force
  $remoteSession = New-PSSession -ComputerName 185.252.86.16 -UseSSL -Port 5986 -Credential $remoteCredential -Authentication Negotiate -SessionOption $remoteOptions

  Invoke-Command -Session $remoteSession -ScriptBlock {
    param($stagePath, $archivePath)
    if (Test-Path $stagePath) { Remove-Item $stagePath -Recurse -Force }
    if (Test-Path $archivePath) { Remove-Item $archivePath -Force }
    New-Item -ItemType Directory -Path $stagePath -Force | Out-Null
  } -ArgumentList $remoteStage, $remoteArchive

  Copy-Item -Path $localArchive -Destination $remoteArchive -ToSession $remoteSession -Force

  Invoke-Command -Session $remoteSession -ScriptBlock {
    param($archivePath, $stagePath)
    Expand-Archive -LiteralPath $archivePath -DestinationPath $stagePath -Force
    Remove-Item $archivePath -Force
    if (-not (Test-Path (Join-Path $stagePath 'index.html'))) { throw 'Staged app build is missing index.html.' }
  } -ArgumentList $remoteArchive, $remoteStage

  Invoke-Command -Session $remoteSession -ScriptBlock {
    param($root, $appPath, $stagePath, $stamp)
    $ErrorActionPreference = 'Stop'
    $webConfig = Join-Path $root 'frontend\web.config'
    $webConfigBackup = "$webConfig.before-admin-$stamp.bak"
    Copy-Item $webConfig $webConfigBackup -Force

    [xml]$config = Get-Content $webConfig -Raw
    $rules = $config.SelectSingleNode('/configuration/system.webServer/rewrite/rules')
    if (-not $rules) { throw 'IIS rewrite rules were not found.' }

    foreach ($oldRule in @($rules.SelectNodes("rule[@name='Gomrok Admin SPA']"))) {
      $rules.RemoveChild($oldRule) | Out-Null
    }

    $rule = $config.CreateElement('rule')
    $rule.SetAttribute('name', 'Gomrok Admin SPA')
    $rule.SetAttribute('stopProcessing', 'true')
    $match = $config.CreateElement('match')
    $match.SetAttribute('url', '^admin/v2(?:/.*)?$')
    $match.SetAttribute('ignoreCase', 'true')
    $rule.AppendChild($match) | Out-Null
    $action = $config.CreateElement('action')
    $action.SetAttribute('type', 'Rewrite')
    $action.SetAttribute('url', 'app/index.html')
    $action.SetAttribute('appendQueryString', 'false')
    $rule.AppendChild($action) | Out-Null
    $firstRule = $rules.SelectSingleNode('rule')
    if ($firstRule) { $rules.InsertBefore($rule, $firstRule) | Out-Null } else { $rules.AppendChild($rule) | Out-Null }
    $config.Save($webConfig)

    $appBackup = "$appPath.before-admin-$stamp"
    if (Test-Path $appBackup) { Remove-Item $appBackup -Recurse -Force }
    if (Test-Path $appPath) { Move-Item $appPath $appBackup }
    Move-Item $stagePath $appPath

    [pscustomobject]@{
      Status = 'frontend-swapped'
      AppBackup = $appBackup
      WebConfigBackup = $webConfigBackup
    } | ConvertTo-Json -Compress
  } -ArgumentList $remoteRoot, $remoteApp, $remoteStage, $deployStamp
} finally {
  if ($localArchive -and (Test-Path $localArchive)) { Remove-Item $localArchive -Force -ErrorAction SilentlyContinue }
  if ($remoteSession) { Remove-PSSession $remoteSession -ErrorAction SilentlyContinue }
}

Write-Output 'ADMIN_ROUTE_DEPLOYED'
