param(
  [Parameter(Mandatory = $true)][string]$ConnectionFile,
  [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'RedSparkHarness/browser-read-only'),
  [switch]$PrepareOnly,
  [switch]$Unregister
)
$ErrorActionPreference = 'Stop'
$packageDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$installPath = [IO.Path]::GetFullPath($InstallDirectory)
$connectionPath = [IO.Path]::GetFullPath($ConnectionFile)
$manifestPath = Join-Path $installPath 'com.redspark.harness.readonly.json'
$registryPath = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.redspark.harness.readonly'
$existing = if (Test-Path -LiteralPath $registryPath) { (Get-Item -LiteralPath $registryPath).GetValue('') } else { $null }
if ($Unregister) {
  if ($existing -and $existing -ne $manifestPath) { throw 'Registration belongs to another installation.' }
  if ($existing) { Remove-Item -LiteralPath $registryPath }
  Write-Output 'Chrome host registration removed. Files and browser data are retained.'
  return
}
if ($existing -and $existing -ne $manifestPath) { throw 'A different browser host is already registered. Unregister its installation first.' }
$relay = Join-Path $packageDirectory 'lib/native-messaging.js'
if (!(Test-Path -LiteralPath $relay -PathType Leaf)) { throw 'Build browser-read-only before registering Chrome.' }
$nodePath = (Get-Command node -CommandType Application | Select-Object -First 1).Source
foreach ($path in @($relay, $connectionPath, $installPath, $nodePath)) {
  if ($path -match '["%!\r\n]') { throw 'Native host paths must not contain quote, percent, exclamation or newline characters.' }
}
$extension = Get-Content -LiteralPath (Join-Path $packageDirectory 'extension/manifest.json') -Raw | ConvertFrom-Json
$sha = [Security.Cryptography.SHA256]::Create()
try { $hash = $sha.ComputeHash([Convert]::FromBase64String($extension.key)) } finally { $sha.Dispose() }
$extensionId = -join (0..15 | ForEach-Object { [char](97 + ($hash[$_] -shr 4)); [char](97 + ($hash[$_] -band 15)) })
$origin = "chrome-extension://$extensionId/"
New-Item -ItemType Directory -Path $installPath -Force | Out-Null
$launcher = Join-Path $installPath 'native-host.cmd'
$utf8 = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText($launcher, "@echo off`r`n`"$nodePath`" `"$relay`" `"$connectionPath`" `"$origin`" %*`r`n", $utf8)
$hostManifest = @{ name = 'com.redspark.harness.readonly'; description = 'RedSpark authorized browser reads'; path = $launcher; type = 'stdio'; allowed_origins = @($origin) }
[IO.File]::WriteAllText($manifestPath, (($hostManifest | ConvertTo-Json -Depth 5) + "`n"), $utf8)
if (!$PrepareOnly) {
  New-Item -Path $registryPath -Force | Out-Null
  Set-Item -LiteralPath $registryPath -Value $manifestPath
}
Write-Output "Extension directory: $(Join-Path $packageDirectory 'extension')"
Write-Output "Extension ID: $extensionId"
Write-Output "Host manifest: $manifestPath"
Write-Output "Connection file: $connectionPath"
