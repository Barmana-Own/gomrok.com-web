$ErrorActionPreference = 'Stop'

$deployStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$remotePassword = Read-Host 'Remote password' -AsSecureString
$remoteCredential = [System.Management.Automation.PSCredential]::new('Administrator', $remotePassword)
$remoteOptions = New-PSSessionOption -SkipCACheck -SkipCNCheck -SkipRevocationCheck
$remoteSession = New-PSSession -ComputerName 185.252.86.16 -UseSSL -Port 5986 -Credential $remoteCredential -Authentication Negotiate -SessionOption $remoteOptions

$localRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$localDist = Join-Path $localRoot 'client\dist'
$localServer = Join-Path $localRoot 'server'
$localCompose = Join-Path $localRoot 'docker-compose.yml'
$localAppArchive = Join-Path ([System.IO.Path]::GetTempPath()) "gomrok-app-$deployStamp.zip"
$remoteRoot = 'C:\Websites\gomrok.org'
$remoteApp = Join-Path $remoteRoot 'frontend\app'
$remoteAppStage = Join-Path $remoteRoot 'frontend\app.__new'
$remoteAppArchive = Join-Path $remoteRoot 'app.__new.zip'
$remoteBackend = Join-Path $remoteRoot 'backend'
$remoteBackendStage = Join-Path $remoteRoot 'backend.__new'
$remoteCompose = Join-Path $remoteRoot 'docker-compose.yml'
$remoteComposeStage = Join-Path $remoteRoot 'docker-compose.yml.__new'
$taskName = 'GomrokAppApi'
$apiPort = 13107

try {
  Compress-Archive -Path (Join-Path $localDist '*') -DestinationPath $localAppArchive -Force

  Invoke-Command -Session $remoteSession -ScriptBlock {
    param($appStage, $appArchive, $backendStage, $backendPath, $composeStage, $composePath, $scheduledTaskName, $servicePort)

    if (Test-Path $appStage) { Remove-Item $appStage -Recurse -Force }
    if (Test-Path $appArchive) { Remove-Item $appArchive -Force }
    if (Test-Path $backendStage) { Remove-Item $backendStage -Recurse -Force }
    if (Test-Path $composeStage) { Remove-Item $composeStage -Force }
    New-Item -ItemType Directory -Path $appStage, $backendStage, (Join-Path $backendStage 'src') -Force | Out-Null
  } -ArgumentList $remoteAppStage, $remoteAppArchive, $remoteBackendStage, $remoteBackend, $remoteComposeStage, $remoteCompose, $taskName, $apiPort

  Copy-Item -Path $localAppArchive -Destination $remoteAppArchive -ToSession $remoteSession -Force
  Invoke-Command -Session $remoteSession -ScriptBlock {
    param($appArchive, $appStage)
    $ErrorActionPreference = 'Stop'
    Expand-Archive -LiteralPath $appArchive -DestinationPath $appStage -Force
    Remove-Item $appArchive -Force
  } -ArgumentList $remoteAppArchive, $remoteAppStage
  Copy-Item -Path (Join-Path $localServer 'src\*') -Destination (Join-Path $remoteBackendStage 'src') -ToSession $remoteSession -Recurse -Force
  Copy-Item -Path (Join-Path $localServer 'package.json') -Destination (Join-Path $remoteBackendStage 'package.json') -ToSession $remoteSession -Force
  Copy-Item -Path (Join-Path $localServer 'schema.sql') -Destination (Join-Path $remoteBackendStage 'schema.sql') -ToSession $remoteSession -Force
  Copy-Item -Path $localCompose -Destination $remoteComposeStage -ToSession $remoteSession -Force

  $deployResult = Invoke-Command -Session $remoteSession -ScriptBlock {
    param($root, $appPath, $appStage, $backendPath, $backendStage, $composePath, $composeStage, $scheduledTaskName, $servicePort, $stamp)

    $ErrorActionPreference = 'Stop'
    $appBackup = "$appPath.backup-$stamp"
    $backendBackup = "$backendPath.backup-$stamp"
    $composeBackup = "$composePath.before-$stamp.bak"
    $webConfig = Join-Path $root 'frontend\web.config'
    $webConfigBackup = "$webConfig.before-app-$stamp.bak"

    if (-not (Test-Path (Join-Path $appStage 'index.html'))) { throw 'Staged app build is missing index.html.' }
    if (-not (Test-Path (Join-Path $backendStage 'src\app.js'))) { throw 'Staged backend is missing src/app.js.' }
    if (-not (Test-Path $composeStage)) { throw 'Staged Docker Compose file is missing.' }

    New-Item -ItemType Directory -Path (Join-Path $backendStage 'logs') -Force | Out-Null

    # Keep the current API alive while files are being transferred. Stop it
    # only after every staged file has arrived and passed validation.
    if (Get-ScheduledTask -TaskName $scheduledTaskName -ErrorAction SilentlyContinue) {
      Stop-ScheduledTask -TaskName $scheduledTaskName -ErrorAction SilentlyContinue
      Unregister-ScheduledTask -TaskName $scheduledTaskName -Confirm:$false
      Start-Sleep -Seconds 2
    }

    if (Test-Path $appPath) { Move-Item $appPath $appBackup }
    Move-Item $appStage $appPath
    if (Test-Path $backendPath) { Move-Item $backendPath $backendBackup }
    Move-Item $backendStage $backendPath
    if (Test-Path $composePath) { Move-Item $composePath $composeBackup }
    Move-Item $composeStage $composePath

    $dbPort = 3307
    $dbPassword = ''
    $databaseMode = 'existing-mariadb'
    $dockerReady = $false
    $dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
    if ($dockerCommand) {
      $env:Path = "$($dockerCommand.Source | Split-Path);$env:Path"
      try {
        & $dockerCommand.Source info --format '{{.ServerVersion}}' *> $null
        $dockerReady = ($LASTEXITCODE -eq 0)
      } catch {
        $dockerReady = $false
      }
    }

    if ($dockerReady) {
      $dbPort = 3308
      $databaseMode = 'docker-mysql'
      $dbBytes = New-Object byte[] 24
      $dbRandom = [System.Security.Cryptography.RandomNumberGenerator]::Create()
      $dbRandom.GetBytes($dbBytes)
      $dbRandom.Dispose()
      $dbPassword = ([Convert]::ToHexString($dbBytes)).ToLowerInvariant()
      $dockerEnv = Join-Path $root '.env.docker'
      @(
        "MYSQL_PORT=$dbPort"
        "MYSQL_ROOT_PASSWORD=$dbPassword"
        'MYSQL_DATABASE=gomrok'
        'MYSQL_SCHEMA_PATH=./backend/schema.sql'
      ) | Set-Content -Path $dockerEnv -Encoding ascii

      Push-Location $root
      try {
        & docker compose --env-file $dockerEnv up -d mysql *> (Join-Path $root 'backups\docker-compose.log')
        if ($LASTEXITCODE -ne 0) { throw 'Docker MySQL could not be started.' }
        $containerName = 'gomrok-mysql'
        $ready = $false
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
          & docker exec $containerName mysql --user=root "--password=$dbPassword" --protocol=TCP --host=127.0.0.1 --execute='SELECT 1' *> $null
          if ($LASTEXITCODE -eq 0) { $ready = $true; break }
          Start-Sleep -Seconds 2
        }
        if (-not $ready) { throw 'Docker MySQL did not become ready.' }

        $latestBackup = Get-ChildItem (Join-Path $root 'backups\gomrok-before-docker-*.sql') -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($latestBackup) {
          $existingRows = & docker exec $containerName mysql --user=root "--password=$dbPassword" --protocol=TCP --host=127.0.0.1 --batch --skip-column-names --execute="SELECT COUNT(*) FROM gomrok.registration_requests" 2>$null
          if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace(($existingRows -join ''))) {
            Get-Content -Path $latestBackup.FullName -Raw | & docker exec -i $containerName mysql --user=root "--password=$dbPassword"
            if ($LASTEXITCODE -ne 0) { throw 'Docker MySQL data restore failed.' }
          }
        }
      } finally {
        Pop-Location
      }
    }

    $jwtBytes = New-Object byte[] 48
    $randomGenerator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $randomGenerator.GetBytes($jwtBytes)
    $randomGenerator.Dispose()
    $jwtSecret = [Convert]::ToBase64String($jwtBytes)
    @(
      "PORT=$servicePort"
      'CLIENT_ORIGINS=https://gomrok.org,https://www.gomrok.org,http://gomrok.org,http://www.gomrok.org'
      "JWT_SECRET=$jwtSecret"
      'DB_HOST=127.0.0.1'
      "DB_PORT=$dbPort"
      'DB_NAME=gomrok'
      'DB_USER=root'
      "DB_PASSWORD=$dbPassword"
    ) | Set-Content -Path (Join-Path $backendPath '.env') -Encoding utf8

    @(
      '@echo off'
      "cd /d `"$backendPath`""
      "`"C:\Program Files\nodejs\node.exe`" `"$backendPath\src\app.js`" >> `"$backendPath\logs\api.log`" 2>&1"
    ) | Set-Content -Path (Join-Path $backendPath 'run-api.cmd') -Encoding ascii

    $installLog = Join-Path $backendPath 'logs\install.log'
    $migrationLog = Join-Path $backendPath 'logs\migrate.log'
    Push-Location $backendPath
    try {
      & 'C:\Program Files\nodejs\npm.cmd' install --omit=dev --no-audit --no-fund *> $installLog
      if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE" }
      & 'C:\Program Files\nodejs\npm.cmd' run db:migrate *> $migrationLog
      if ($LASTEXITCODE -ne 0) { throw "database migration failed with exit code $LASTEXITCODE" }
    } finally {
      Pop-Location
    }

    Import-Module WebAdministration
    $appPoolName = 'GomrokOrgAppPool'
    if (-not (Test-Path "IIS:\AppPools\$appPoolName")) {
      New-WebAppPool -Name $appPoolName | Out-Null
    }
    if (-not (Get-Website -Name 'gomrok.org' -ErrorAction SilentlyContinue)) {
      New-Website -Name 'gomrok.org' -PhysicalPath (Join-Path $root 'frontend') -Port 80 -HostHeader 'gomrok.org' -ApplicationPool $appPoolName | Out-Null
    } else {
      Set-ItemProperty "IIS:\Sites\gomrok.org" -Name physicalPath -Value (Join-Path $root 'frontend')
      Set-ItemProperty "IIS:\Sites\gomrok.org" -Name applicationPool -Value $appPoolName
    }
    if (-not (Get-WebBinding -Name 'gomrok.org' -Protocol http -Port 80 -HostHeader 'www.gomrok.org' -ErrorAction SilentlyContinue)) {
      New-WebBinding -Name 'gomrok.org' -Protocol http -Port 80 -HostHeader 'www.gomrok.org' | Out-Null
    }

    if (Test-Path $webConfig) {
      [xml]$config = Get-Content $webConfig -Raw
    } else {
      $config = New-Object System.Xml.XmlDocument
      $config.AppendChild($config.CreateXmlDeclaration('1.0', 'UTF-8', $null)) | Out-Null
      $configurationNode = $config.AppendChild($config.CreateElement('configuration'))
      $serverNode = $configurationNode.AppendChild($config.CreateElement('system.webServer'))
      $rewriteNode = $serverNode.AppendChild($config.CreateElement('rewrite'))
      $rewriteNode.AppendChild($config.CreateElement('rules')) | Out-Null
      $serverNode.AppendChild($config.CreateElement('httpErrors')).SetAttribute('existingResponse', 'PassThrough')
      $config.Save($webConfig)
    }
    Copy-Item $webConfig $webConfigBackup -Force
    $rules = $config.SelectSingleNode('/configuration/system.webServer/rewrite/rules')
    if (-not $rules) {
      $serverNode = $config.SelectSingleNode('/configuration/system.webServer')
      if (-not $serverNode) { throw 'IIS system.webServer node was not found.' }
      $rewriteNode = $serverNode.AppendChild($config.CreateElement('rewrite'))
      $rules = $rewriteNode.AppendChild($config.CreateElement('rules'))
    }

    # Keep static assets small on the wire and make the optimized formats
    # available on IIS. The generated filenames are content-hashed, so the
    # browser can safely cache them for a long time outside this config.
    $serverNode = $config.SelectSingleNode('/configuration/system.webServer')
    if (-not $serverNode) { throw 'IIS system.webServer node was not found.' }
    $compression = $serverNode.SelectSingleNode('urlCompression')
    if (-not $compression) { $compression = $serverNode.AppendChild($config.CreateElement('urlCompression')) }
    $compression.SetAttribute('doStaticCompression', 'true')
    $compression.SetAttribute('doDynamicCompression', 'true')

    $staticContent = $serverNode.SelectSingleNode('staticContent')
    if (-not $staticContent) { $staticContent = $serverNode.AppendChild($config.CreateElement('staticContent')) }
    foreach ($mime in @(
      @{ Extension = '.webp'; Type = 'image/webp' }
      @{ Extension = '.woff2'; Type = 'font/woff2' }
    )) {
      foreach ($existingMime in @($staticContent.SelectNodes("mimeMap[@fileExtension='$($mime.Extension)']"))) {
        $staticContent.RemoveChild($existingMime) | Out-Null
      }
      foreach ($existingRemove in @($staticContent.SelectNodes("remove[@fileExtension='$($mime.Extension)']"))) {
        $staticContent.RemoveChild($existingRemove) | Out-Null
      }
      $removeNode = $config.CreateElement('remove')
      $removeNode.SetAttribute('fileExtension', $mime.Extension)
      $staticContent.AppendChild($removeNode) | Out-Null
      $mimeNode = $config.CreateElement('mimeMap')
      $mimeNode.SetAttribute('fileExtension', $mime.Extension)
      $mimeNode.SetAttribute('mimeType', $mime.Type)
      $staticContent.AppendChild($mimeNode) | Out-Null
    }

    # Remove rules owned by this deployment before adding the current set.
    # This keeps repeated deployments idempotent and avoids duplicate-rule
    # errors from IIS URL Rewrite.
    $managedRuleNames = @(
      'Gomrok Admin SPA'
      'Gomrok App SPA'
      'Gomrok App static assets'
      'Gomrok App API reverse proxy'
    )
    foreach ($existingRule in @($rules.SelectNodes('rule'))) {
      if ($managedRuleNames -contains $existingRule.GetAttribute('name')) {
        $rules.RemoveChild($existingRule) | Out-Null
      }
    }
    $firstRule = $rules.SelectSingleNode('rule')

    function New-RuleNode {
      param([string]$name, [string]$pattern, [string]$actionType, [string]$actionUrl, [string]$appendQuery)
      $rule = $config.CreateElement('rule')
      $rule.SetAttribute('name', $name)
      $rule.SetAttribute('stopProcessing', 'true')
      $match = $config.CreateElement('match')
      $match.SetAttribute('url', $pattern)
      $match.SetAttribute('ignoreCase', 'true')
      $rule.AppendChild($match) | Out-Null
      $action = $config.CreateElement('action')
      $action.SetAttribute('type', $actionType)
      if ($actionUrl) { $action.SetAttribute('url', $actionUrl) }
      if ($appendQuery) { $action.SetAttribute('appendQueryString', $appendQuery) }
      $rule.AppendChild($action) | Out-Null
      return $rule
    }

    $adminSpa = New-RuleNode 'Gomrok Admin SPA' '^admin/v2(?:/.*)?$' 'Rewrite' 'app/index.html' 'false'
    $appSpa = New-RuleNode 'Gomrok App SPA' '^app(?:/.*)?$' 'Rewrite' 'app/index.html' 'false'
    $appAssets = New-RuleNode 'Gomrok App static assets' '^app/(assets/.*|images/.*|favicon\.svg|manifest\.webmanifest)$' 'None' $null $null
    $appApi = New-RuleNode 'Gomrok App API reverse proxy' '^app/api(?:/(.*))?$' 'Rewrite' "http://127.0.0.1:$servicePort/api/{R:1}" 'true'

    if ($firstRule) {
      $rules.InsertBefore($adminSpa, $firstRule) | Out-Null
      $rules.InsertBefore($appSpa, $adminSpa) | Out-Null
      $rules.InsertBefore($appAssets, $appSpa) | Out-Null
      $rules.InsertBefore($appApi, $appAssets) | Out-Null
    } else {
      $rules.AppendChild($appApi) | Out-Null
      $rules.AppendChild($appAssets) | Out-Null
      $rules.AppendChild($adminSpa) | Out-Null
      $rules.AppendChild($appSpa) | Out-Null
    }
    $config.Save($webConfig)

    $taskAction = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$backendPath\run-api.cmd`"" -WorkingDirectory $backendPath
    $taskTrigger = New-ScheduledTaskTrigger -AtStartup
    $taskPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $taskSettings = New-ScheduledTaskSettingsSet -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
    Register-ScheduledTask -TaskName $scheduledTaskName -Action $taskAction -Trigger $taskTrigger -Principal $taskPrincipal -Settings $taskSettings -Force | Out-Null
    Start-ScheduledTask -TaskName $scheduledTaskName
    Start-Sleep -Seconds 5

    $health = try {
      (Invoke-WebRequest -Uri "http://127.0.0.1:$servicePort/api/health" -UseBasicParsing -TimeoutSec 10).Content
    } catch {
      "health_error: $($_.Exception.Message)"
    }

    [pscustomobject]@{
      AppPath = $appPath
      AppBackup = $appBackup
      BackendPath = $backendPath
      BackendBackup = $backendBackup
      ComposePath = $composePath
      ComposeBackup = $composeBackup
      DatabaseMode = $databaseMode
      DatabasePort = $dbPort
      WebConfigBackup = $webConfigBackup
      ApiHealth = $health
      ApiLog = (Get-Content (Join-Path $backendPath 'logs\api.log') -Tail 25 -ErrorAction SilentlyContinue | Out-String)
      Port = (Get-NetTCPConnection -State Listen -LocalPort $servicePort -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort -First 1)
    }
  } -ArgumentList $remoteRoot, $remoteApp, $remoteAppStage, $remoteBackend, $remoteBackendStage, $remoteCompose, $remoteComposeStage, $taskName, $apiPort, $deployStamp

  $deployResult | Format-List | Out-String
} finally {
  if (Test-Path $localAppArchive) { Remove-Item $localAppArchive -Force -ErrorAction SilentlyContinue }
  if ($remoteSession) { Remove-PSSession $remoteSession }
}
