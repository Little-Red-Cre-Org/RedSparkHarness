# Run native Electron cleanup and NSIS replacement checks against the prepared Windows target.
param(
  [Parameter(Mandatory)][string]$Electron,
  [Parameter(Mandatory)][string]$Makensis,
  [Parameter(Mandatory)][string]$SevenZip,
  [Parameter(Mandatory)][string]$PluginDir,
  [string]$Node
)
$ErrorActionPreference = 'Stop'
$desktopRoot = Split-Path $PSScriptRoot -Parent
$scratch = [System.IO.Directory]::CreateTempSubdirectory('dsh-desktop-native-').FullName
$fixtureRoot = Join-Path $desktopRoot 'tests/fixtures'
if (-not $Node) { $Node = Join-Path $desktopRoot '.desktop-build/targets/win-x64/runtime/node/node.exe' }

function Invoke-Checked([string]$Executable, [string[]]$Arguments) {
  & $Executable @Arguments | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "$Executable exited with $LASTEXITCODE" }
}

try {
  $previousRunAsNode = $env:ELECTRON_RUN_AS_NODE
  try {
    $env:ELECTRON_RUN_AS_NODE = '1'
    Invoke-Checked $electron @((Join-Path $fixtureRoot 'owned-directory-smoke.mjs'))
  } finally { $env:ELECTRON_RUN_AS_NODE = $previousRunAsNode }

  $cleanupExe = Join-Path $scratch 'cleanup.exe'
  $cleanupResult = Join-Path $scratch 'cleanup.txt'
  Invoke-Checked $Makensis @('/V2', "/DOUTPUT_FILE=$cleanupExe", "/DRESULT_FILE=$cleanupResult", (Join-Path $fixtureRoot 'installer-cleanup-smoke.nsi'))
  Invoke-Checked $cleanupExe @('/S')
  if ((Get-Content -LiteralPath $cleanupResult -Raw) -ne 'scratch removed; archive, plugin, rollback, registers and error flags preserved') {
    throw 'NSIS cleanup did not preserve its sentinels'
  }

  $payload = Join-Path $scratch 'payload'
  New-Item -ItemType Directory -Path $payload | Out-Null
  [System.IO.File]::WriteAllText((Join-Path $payload 'locked.txt'), 'new runtime')
  [System.IO.File]::WriteAllText((Join-Path $payload 'asset.txt'), 'new asset')
  $archive = Join-Path $scratch 'payload.7z'
  Invoke-Checked $SevenZip @('a', '-bd', '-t7z', $archive, "$payload/*")
  foreach ($mode in @('copy', 'direct')) {
    $target = Join-Path $scratch $mode
    New-Item -ItemType Directory -Path $target | Out-Null
    $locked = Join-Path $target 'locked.txt'
    [System.IO.File]::WriteAllText($locked, 'old runtime')
    $probeExe = Join-Path $scratch "$mode.exe"
    $probeResult = Join-Path $scratch "$mode.txt"
    $compileArgs = @('/V2', "/DOUTPUT_FILE=$probeExe", "/DRESULT_FILE=$probeResult", "/DPAYLOAD_FILE=$archive", "/DTARGET_DIR=$target", "/DPLUGIN_DIR=$PluginDir")
    if ($mode -eq 'direct') { $compileArgs += '/DDIRECT' }
    $compileArgs += Join-Path $fixtureRoot 'installer-write-failure-smoke.nsi'
    Invoke-Checked $Makensis $compileArgs
    $handle = [System.IO.File]::Open($locked, 'Open', 'Read', 'Read')
    try { Invoke-Checked $probeExe @('/S') }
    finally { $handle.Dispose() }
    $flag = if ($mode -eq 'copy') { 'true' } else { 'false' }
    $expected = "errorFlag=$flag`nlocked=old runtime`nasset=new asset"
    if ((Get-Content -LiteralPath $probeResult -Raw).Replace("`r`n", "`n").TrimEnd() -ne $expected) {
      throw "Unexpected NSIS $mode replacement result"
    }
  }
  $installation = Join-Path $scratch 'installed'
  $runtime = Join-Path $installation 'resources/dsh'
  $deep = Join-Path $runtime (('a' * 80) + '/' + ('b' * 80) + '/' + ('c' * 80))
  New-Item -ItemType Directory -Path $deep | Out-Null
  $longFile = Join-Path $deep 'long-file.txt'
  if ($longFile.Length -le 260) { throw 'Uninstall fixture must exceed MAX_PATH' }
  [System.IO.File]::WriteAllText($longFile, 'owned runtime')
  $external = Join-Path $scratch 'external'
  New-Item -ItemType Directory -Path $external | Out-Null
  $sentinel = Join-Path $external 'sentinel.txt'
  [System.IO.File]::WriteAllText($sentinel, 'preserved target')
  New-Item -ItemType Junction -Path (Join-Path $runtime 'external-link') -Target $external | Out-Null
  $uninstallExe = Join-Path $scratch 'uninstall-probe.exe'
  $upgradeExe = Join-Path $scratch 'upgrade-probe.exe'
  foreach ($updated in @(0, 1)) {
    $output = if ($updated) { $upgradeExe } else { $uninstallExe }
    Invoke-Checked $Makensis @('/V2', "/DOUTPUT_FILE=$output", "/DTARGET_DIR=$installation", "/DUPDATED=$updated", "/DPROJECT_DIR=$desktopRoot", (Join-Path $fixtureRoot 'uninstaller-runtime-smoke.nsi'))
  }
  $probe = Start-Process -FilePath $upgradeExe -WindowStyle Hidden -Wait -PassThru
  if ($probe.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $longFile)) { throw 'Upgrade cleanup touched the rollback runtime' }
  $probe = Start-Process -FilePath $uninstallExe -WindowStyle Hidden -Wait -PassThru
  if ($probe.ExitCode -ne 1 -or -not (Test-Path -LiteralPath $longFile)) { throw 'Missing Node did not stop uninstall' }
  $nodeDir = Join-Path $installation 'resources/runtime/node'
  New-Item -ItemType Directory -Path $nodeDir | Out-Null
  Copy-Item -LiteralPath $Node -Destination (Join-Path $nodeDir 'node.exe')
  $handle = [System.IO.File]::Open($longFile, 'Open', 'Read', 'Read')
  try {
    $probe = Start-Process -FilePath $uninstallExe -WindowStyle Hidden -Wait -PassThru
    if ($probe.ExitCode -ne 1 -or -not (Test-Path -LiteralPath $longFile)) { throw 'Locked runtime did not stop uninstall' }
  } finally { $handle.Dispose() }
  $probe = Start-Process -FilePath $uninstallExe -WindowStyle Hidden -Wait -PassThru
  if ($probe.ExitCode -ne 0 -or (Test-Path -LiteralPath $runtime)) { throw 'Uninstall left its long-path runtime' }
  if ((Get-Content -LiteralPath $sentinel -Raw) -ne 'preserved target') { throw 'Uninstall followed a directory junction' }
  if (-not (Test-Path -LiteralPath (Join-Path $nodeDir 'node.exe'))) { throw 'Cleanup removed the runtime needed for retry' }
  Write-Output 'Electron cleanup and NSIS cleanup/replacement/uninstall smokes passed.'
} finally {
  $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
  $resolvedScratch = [System.IO.Path]::GetFullPath($scratch)
  if (-not $resolvedScratch.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing cleanup outside the temporary root: $resolvedScratch"
  }
  Remove-Item -LiteralPath $resolvedScratch -Recurse -Force
}
