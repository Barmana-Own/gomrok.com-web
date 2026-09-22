param(
  [string]$ZipPath = '',
  [string]$SiteDistPath = (Join-Path $PSScriptRoot 'site\dist')
)

$ErrorActionPreference = 'Stop'

$deployStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$temporaryPackageRoot = $null
$temporaryZip = $null

if ([string]::IsNullOrWhiteSpace($ZipPath)) {
  if (Test-Path -LiteralPath $SiteDistPath -PathType Container) {
    $temporaryPackageRoot = Join-Path ([IO.Path]::GetTempPath()) "gomrok-site-package-$deployStamp"
    $nestedDistPath = Join-Path $temporaryPackageRoot 'terminal-industries.com2\dist'
    New-Item -ItemType Directory -Path $nestedDistPath -Force | Out-Null
    Copy-Item -Path (Join-Path $SiteDistPath '*') -Destination $nestedDistPath -Recurse -Force
    $temporaryZip = Join-Path ([IO.Path]::GetTempPath()) "gomrok-customs-site-$deployStamp.zip"
    Compress-Archive -Path (Join-Path $temporaryPackageRoot 'terminal-industries.com2') -DestinationPath $temporaryZip -Force
    $ZipPath = $temporaryZip
  } else {
    $ZipPath = 'E:\terminal-industries.com2\terminal-industries.com2-customs-site.zip'
  }
}

$zipPath = [IO.Path]::GetFullPath($ZipPath)
$remoteZip = "C:\Windows\Temp\terminal-customs-site-$deployStamp.zip"
$remotePassword = Read-Host 'Remote password' -AsSecureString
$remoteCredential = [System.Management.Automation.PSCredential]::new('Administrator', $remotePassword)
$remoteOptions = New-PSSessionOption -SkipCACheck -SkipCNCheck -SkipRevocationCheck
$remoteSession = $null

if (-not (Test-Path -LiteralPath $zipPath -PathType Leaf)) {
  throw "Provided site ZIP is missing: $zipPath"
}

try {
  try {
    $remoteSession = New-PSSession -ComputerName 185.252.86.16 -UseSSL -Port 5986 -Credential $remoteCredential -Authentication Basic -SessionOption $remoteOptions
  } catch {
    $remoteSession = New-PSSession -ComputerName 185.252.86.16 -UseSSL -Port 5986 -Credential $remoteCredential -Authentication Negotiate -SessionOption $remoteOptions
  }

  $frontendPath = Invoke-Command -Session $remoteSession -ScriptBlock {
    Import-Module WebAdministration
    $site = Get-Website -Name 'gomrok.org' -ErrorAction Stop
    $expectedRoot = 'C:\Websites\gomrok.org'
    $physicalPath = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables([string]$site.PhysicalPath)).TrimEnd('\')
    if (-not $physicalPath.StartsWith($expectedRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
      throw 'IIS physical path is outside the expected Gomrok root.'
    }
    $physicalPath
  }
  $frontendPath = [string]$frontendPath | Select-Object -Last 1

  Copy-Item -LiteralPath $zipPath -Destination $remoteZip -ToSession $remoteSession -Force

  Invoke-Command -Session $remoteSession -ScriptBlock {
    param($frontend, $zipFile, $stamp)
    $ErrorActionPreference = 'Stop'
    $expectedRoot = 'C:\Websites\gomrok.org'
    $frontend = [IO.Path]::GetFullPath([string]$frontend).TrimEnd('\')
    if (-not $frontend.StartsWith($expectedRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
      throw 'Resolved frontend path is outside the expected Gomrok root.'
    }

    $extractPath = Join-Path $frontend "root.__extract-$stamp"
    $stagePath = Join-Path $frontend "root.__new-$stamp"
    $backupPath = Join-Path $frontend "root.backup-$stamp"
    $configPath = Join-Path $frontend 'web.config'
    $sourceDist = Join-Path $extractPath 'terminal-industries.com2\dist'
    $swapped = $false

    try {
      foreach ($path in @($extractPath, $stagePath, $backupPath)) {
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
      }
      Expand-Archive -LiteralPath $zipFile -DestinationPath $extractPath -Force
      foreach ($requiredFile in @('index.html', 'styles.css', 'app.js')) {
        if (-not (Test-Path -LiteralPath (Join-Path $sourceDist $requiredFile) -PathType Leaf)) {
          throw "Provided dist is missing $requiredFile."
        }
      }
      if (-not (Test-Path -LiteralPath (Join-Path $frontend 'app\index.html') -PathType Leaf)) {
        throw 'Existing /app application was not found; deployment stopped.'
      }
      if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
        $recoveryConfig = Get-ChildItem -LiteralPath $frontend -Directory -Filter 'root.backup-*' |
          Sort-Object LastWriteTime -Descending |
          ForEach-Object {
            $candidate = Join-Path $_.FullName 'web.config'
            if (Test-Path -LiteralPath $candidate -PathType Leaf) { $candidate }
          } |
          Select-Object -First 1
        if ($recoveryConfig) {
          Copy-Item -LiteralPath $recoveryConfig -Destination $configPath -Force
        } else {
          throw 'Existing IIS web.config is missing and no server-side backup contains one.'
        }
      }

      New-Item -ItemType Directory -Path $stagePath -Force | Out-Null
      Copy-Item -Path (Join-Path $sourceDist '*') -Destination $stagePath -Recurse -Force

      $configXml = [xml](Get-Content -LiteralPath $configPath -Raw)
      $rootRule = $configXml.SelectSingleNode('/configuration/system.webServer/rewrite/rules/rule[@name="Gomrok Root SPA"]')
      if ($rootRule) {
        $rootAction = $rootRule.SelectSingleNode('action')
        if (-not $rootAction) { throw 'Existing root SPA rule has no action; deployment stopped.' }
        $rootAction.SetAttribute('url', 'index.html')
        $rootAction.SetAttribute('appendQueryString', 'true')
      } else {
        $rulesNode = $configXml.SelectSingleNode('/configuration/system.webServer/rewrite/rules')
        if (-not $rulesNode) { throw 'Expected IIS rewrite rules were not found; deployment stopped.' }
        $rootRule = $configXml.CreateElement('rule')
        $rootRule.SetAttribute('name', 'Gomrok Root SPA')
        $rootRule.SetAttribute('stopProcessing', 'true')
        $matchNode = $configXml.CreateElement('match')
        $matchNode.SetAttribute('url', '^$')
        $matchNode.SetAttribute('ignoreCase', 'true')
        $actionNode = $configXml.CreateElement('action')
        $actionNode.SetAttribute('type', 'Rewrite')
        $actionNode.SetAttribute('url', 'index.html')
        $actionNode.SetAttribute('appendQueryString', 'true')
        [void]$rootRule.AppendChild($matchNode)
        [void]$rootRule.AppendChild($actionNode)
        [void]$rulesNode.AppendChild($rootRule)
      }
      $defaultDocument = $configXml.SelectSingleNode('/configuration/system.webServer/defaultDocument')
      if ($defaultDocument) { [void]$defaultDocument.ParentNode.RemoveChild($defaultDocument) }
      $stageConfig = Join-Path $stagePath 'web.config'
      $configXml.Save($stageConfig)
      [xml](Get-Content -LiteralPath $stageConfig -Raw) | Out-Null

      New-Item -ItemType Directory -Path $backupPath -Force | Out-Null
      Get-ChildItem -LiteralPath $frontend -Force -File | Move-Item -Destination $backupPath
      foreach ($stagedItem in @(Get-ChildItem -LiteralPath $stagePath -Force)) {
        $destination = Join-Path $frontend $stagedItem.Name
        if ($stagedItem.PSIsContainer -and (Test-Path -LiteralPath $destination)) {
          Copy-Item -LiteralPath $stagedItem.FullName -Destination $destination -Recurse -Force
          Remove-Item -LiteralPath $stagedItem.FullName -Recurse -Force
        } else {
          Move-Item -LiteralPath $stagedItem.FullName -Destination $frontend -Force
        }
      }
      $swapped = $true
      $deployedConfigXml = [xml](Get-Content -LiteralPath (Join-Path $frontend 'web.config') -Raw)
      $deployedRootAction = $deployedConfigXml.SelectSingleNode('/configuration/system.webServer/rewrite/rules/rule[@name="Gomrok Root SPA"]/action[@url="index.html"]')

      [pscustomobject]@{
        DeployedAt = $stamp
        FrontendPath = $frontend
        BackupPath = $backupPath
        RootIndexBytes = (Get-Item -LiteralPath (Join-Path $frontend 'index.html')).Length
        RootScriptBytes = (Get-Item -LiteralPath (Join-Path $frontend 'app.js')).Length
        AppPreserved = Test-Path -LiteralPath (Join-Path $frontend 'app\index.html')
        RootRuleTargetsRootIndex = [bool]$deployedRootAction
      } | Format-List
    } catch {
      if ($swapped) {
        foreach ($file in @(Get-ChildItem -LiteralPath $frontend -Force -File)) {
          Move-Item -LiteralPath $file.FullName -Destination $stagePath -Force -ErrorAction SilentlyContinue
        }
        if (Test-Path -LiteralPath $backupPath) {
          Get-ChildItem -LiteralPath $backupPath -Force -File | Move-Item -Destination $frontend -Force
        }
      }
      throw
    } finally {
      if (Test-Path -LiteralPath $extractPath) { Remove-Item -LiteralPath $extractPath -Recurse -Force -ErrorAction SilentlyContinue }
      if (Test-Path -LiteralPath $stagePath) { Remove-Item -LiteralPath $stagePath -Recurse -Force -ErrorAction SilentlyContinue }
    }
  } -ArgumentList $frontendPath, $remoteZip, $deployStamp
} finally {
  if ($remoteSession) {
    Invoke-Command -Session $remoteSession -ScriptBlock {
      param($path)
      if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue }
    } -ArgumentList $remoteZip -ErrorAction SilentlyContinue
    Remove-PSSession $remoteSession
  }
  Remove-Variable remotePassword -ErrorAction SilentlyContinue
  Remove-Variable remoteCredential -ErrorAction SilentlyContinue
  if ($temporaryZip -and (Test-Path -LiteralPath $temporaryZip)) {
    Remove-Item -LiteralPath $temporaryZip -Force -ErrorAction SilentlyContinue
  }
  if ($temporaryPackageRoot -and (Test-Path -LiteralPath $temporaryPackageRoot)) {
    Remove-Item -LiteralPath $temporaryPackageRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
