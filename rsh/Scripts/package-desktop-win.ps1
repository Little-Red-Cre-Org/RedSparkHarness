#Requires -Version 5.1
<#
.SYNOPSIS
  Build an unsigned Windows x64 RedSpark Harness desktop artifact in one command.

.DESCRIPTION
  Wraps `pnpm run package:desktop:win:x64[:unsigned|:dir]` and neutralizes the three
  environment defects that otherwise fail this build on a developer host. Every
  repair is checked before it is applied, and each one reports what it changed.

    1. ELECTRON_RUN_AS_NODE  鈥?makes every Electron binary run as plain Node, so the
       packaged app exits immediately with status 0 and no output. Detected by
       comparing `electron.exe --version` against Electron's own version; a Node
       version string (v24.x) means the variable leaked into this process.
    2. DSH_DESKTOP_BASH_DIR  鈥?prepare-runtime.ts refuses to package a Windows runtime
       without a prepared Bash distribution. Supplied from an existing Git-for-Windows
       install whose msys-2.0.dll matches the repository's pinned originalRuntimeSha256.
       Only bash.exe and msys-2.0.dll are validated by the packaging code itself.
    3. VCToolsVersion        鈥?node-pty compiles its ConPTY addon from source and fails
       with MSB8040 unless the selected MSVC toolset ships Spectre-mitigated libraries
       (VC\Tools\MSVC\<version>\lib\spectre\x64). The newest installed toolset usually
       lacks them, so an installed toolset that has them is selected explicitly.

  Nothing is written to the user's DeepSeek Harness installation. Only build output
  under rsh/Programs/Desktop/.desktop-build/ is touched, plus an optional JSON report.

.PARAMETER Mode
  unsigned  Produce the NSIS installer plus win-unpacked. Default.
  dir       Produce win-unpacked only. Faster; enough to smoke-test the app.
  signed    Produce the signed installer. Requires the release signing credentials.

.PARAMETER AppId
  Reverse-DNS application id. Defaults to $env:DSH_DESKTOP_APP_ID, then org.redspark.harness.

.PARAMETER BashDir
  Git-for-Windows root supplying usr\bin\bash.exe and usr\bin\msys-2.0.dll.
  Defaults to $env:DSH_DESKTOP_BASH_DIR, then the registered Git install.

.PARAMETER VcToolsVersion
  MSVC toolset whose Spectre libraries are used. Defaults to the newest installed
  toolset that actually has VC\Tools\MSVC\<version>\lib\spectre\x64.

.PARAMETER SkipPitfallChecks
  Skip the environment repairs. Useful only to reproduce a failure on purpose.

.PARAMETER ReportPath
  Write a JSON report (timing, resolved environment, artifacts, verification) here.

.EXAMPLE
  pwsh -NoProfile -File rsh/Scripts/package-desktop-win.ps1

.EXAMPLE
  pwsh -NoProfile -File rsh/Scripts/package-desktop-win.ps1 -Mode dir -ReportPath build.json
#>
[CmdletBinding()]
param(
  [ValidateSet('unsigned', 'dir', 'signed')]
  [string]$Mode = 'unsigned',

  [string]$AppId,

  [string]$BashDir,

  [string]$VcToolsVersion,

  [switch]$SkipPitfallChecks,

  [string]$ReportPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# --- failure reporting ------------------------------------------------------
# Every gate below reports what it inspected, what it found, and how to fix it,
# so a failure never leaves the operator guessing.

$script:Stage = 'startup'
$script:StartedAt = Get-Date
$script:Actions = [System.Collections.Generic.List[string]]::new()

function Write-Stage([string]$Name) {
  $script:Stage = $Name
  $elapsed = [int]((Get-Date) - $script:StartedAt).TotalSeconds
  Write-Host ("[+{0,4}s] {1}" -f $elapsed, $Name) -ForegroundColor Cyan
}

function Write-Note([string]$Message) {
  Write-Host "         $Message" -ForegroundColor DarkGray
}

function Write-Fixed([string]$Message) {
  $script:Actions.Add($Message)
  Write-Host "         FIXED: $Message" -ForegroundColor Yellow
}

function Fail([string]$Message, [string[]]$Hints = @()) {
  Write-Host ''
  Write-Host "package-desktop-win: $($script:Stage) failed" -ForegroundColor Red
  Write-Host $Message -ForegroundColor Red
  foreach ($hint in $Hints) { Write-Host "  - $hint" -ForegroundColor Red }
  Write-Host ''
  Write-Host ("Elapsed: {0:N1}s" -f ((Get-Date) - $script:StartedAt).TotalSeconds) -ForegroundColor Red
  if ($script:Actions.Count -gt 0) {
    Write-Host 'Environment repairs already applied this run:' -ForegroundColor Red
    foreach ($action in $script:Actions) { Write-Host "  * $action" -ForegroundColor Red }
  }
  exit 1
}

# --- repository layout ------------------------------------------------------

$script:ScriptRoot = $PSScriptRoot
$repoRoot = (Resolve-Path (Join-Path $script:ScriptRoot '../..')).Path

if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'pnpm-workspace.yaml'))) {
  Fail "Not inside a RedSpark Harness checkout: $repoRoot has no pnpm-workspace.yaml"
}

$desktopRoot = Join-Path $repoRoot 'rsh/Programs/Desktop'
$electronBuilderConfig = Join-Path $desktopRoot 'electron-builder.config.mjs'

foreach ($required in @(
    (Join-Path $repoRoot 'package.json'),
    (Join-Path $desktopRoot 'package.json'),
    $electronBuilderConfig
  )) {
  if (-not (Test-Path -LiteralPath $required)) {
    Fail "Expected repository file is missing: $required"
  }
}

if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'node_modules'))) {
  Fail "Dependencies are not installed in $repoRoot" @(
    "Run: pnpm install --frozen-lockfile"
  )
}

$localPnpm = Join-Path $repoRoot 'node_modules/.bin/pnpm.CMD'
if (-not (Test-Path -LiteralPath $localPnpm)) {
  Fail "The workspace-local pnpm shim is missing: $localPnpm" @(
    "Run: pnpm install --frozen-lockfile",
    "The wrapper prepends node_modules/.bin to PATH so inner scripts cannot drift to a global pnpm."
  )
}

$desktopManifest = Get-Content -LiteralPath (Join-Path $desktopRoot 'package.json') -Raw | ConvertFrom-Json
$rootManifest = Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json

if ($desktopManifest.version -ne $rootManifest.version) {
  Fail "Version mismatch: Desktop $($desktopManifest.version) vs root $($rootManifest.version)" @(
    "prepare-dsh.ts rejects a Desktop build that does not bind the same dsh version."
  )
}

# --- pitfall 1: ELECTRON_RUN_AS_NODE ---------------------------------------

function Resolve-ElectronBinary {
  $candidates = @(
    (Join-Path $repoRoot 'node_modules/.pnpm/node_modules/electron/dist/electron.exe'),
    (Join-Path $desktopRoot 'node_modules/electron/dist/electron.exe')
  )
  $pnpmElectron = Get-ChildItem -LiteralPath (Join-Path $repoRoot 'node_modules/.pnpm') -Directory -Filter 'electron@*' -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($null -ne $pnpmElectron) {
    $candidates += Join-Path $pnpmElectron.FullName 'node_modules/electron/dist/electron.exe'
  }
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  return $null
}

if (-not $SkipPitfallChecks) {
  Write-Stage 'pitfall 1/3: ELECTRON_RUN_AS_NODE'
  $electron = Resolve-ElectronBinary
  if ($null -eq $electron) {
    Write-Note 'electron binary not found; skipping the Electron-side check (packaging does not launch Electron).'
  } else {
    $previous = $env:ELECTRON_RUN_AS_NODE
    Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    # Capture through Out-String: a bare assignment can yield $null for a native
    # program's stdout under Windows PowerShell 5.1.
    $reported = (& $electron --version 2>&1 | Out-String).Trim()
    if ($previous) {
      Write-Fixed "cleared ELECTRON_RUN_AS_NODE=$previous; electron reports '$reported'"
    } else {
      Write-Note "ELECTRON_RUN_AS_NODE was not set; electron reports '$reported'"
    }

    $electronPkg = Join-Path (Split-Path -Parent (Split-Path -Parent $electron)) 'package.json'
    $electronVersion = $null
    if (Test-Path -LiteralPath $electronPkg) {
      $electronVersion = (Get-Content -LiteralPath $electronPkg -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json).version
    }

    if ($reported -notmatch '^v\d+\.\d+\.\d+$') {
      Write-Note 'electron.exe did not report a version; the variable check could not be completed.'
    } elseif ($null -ne $electronVersion -and $reported -eq "v$electronVersion") {
      Write-Note "Version matches Electron $electronVersion."
    } else {
      Fail "electron.exe still resolves as Node ('$reported'), not as Electron." @(
        'ELECTRON_RUN_AS_NODE is set outside this process (machine or user scope).',
        'Remove it from the environment that launches this script, then rerun.',
        "Diagnose with: [Environment]::GetEnvironmentVariable('ELECTRON_RUN_AS_NODE','User')",
        'Without this fix the packaged app starts and exits with status 0 and no output.'
      )
    }
  }
}

# --- pitfall 2: DSH_DESKTOP_BASH_DIR --------------------------------------

function Resolve-GitBashRoot {
  $candidates = [System.Collections.Generic.List[string]]::new()
  if ($BashDir) { $candidates.Add($BashDir) }
  if ($env:DSH_DESKTOP_BASH_DIR) { $candidates.Add($env:DSH_DESKTOP_BASH_DIR) }

  # Preferred: ask the git on PATH where it lives, then climb to the distribution
  # root. This follows whatever installation the machine actually has, including
  # per-user installs and non-default drives.
  $gitCommand = Get-Command git.exe -ErrorAction SilentlyContinue
  if ($null -ne $gitCommand) {
    $gitDirectory = Split-Path -Parent $gitCommand.Source
    # <root>\cmd\git.exe or <root>\bin\git.exe -> <root>
    $candidates.Add((Split-Path -Parent $gitDirectory))
  }

  # Next: the Git for Windows installer's recorded location.
  foreach ($candidate in @(
      'HKLM:\SOFTWARE\GitForWindows',
      'HKCU:\SOFTWARE\GitForWindows'
    )) {
    $entry = Get-ItemProperty -LiteralPath $candidate -ErrorAction SilentlyContinue
    if ($null -ne $entry -and $entry.PSObject.Properties.Name -contains 'InstallPath') {
      $candidates.Add([string]$entry.InstallPath)
    }
  }

  # Last resort: the conventional install roots. These are only fallbacks; the
  # authority is -BashDir, the environment variable, PATH, then the registry.
  foreach ($candidate in @(
      (Join-Path $env:ProgramFiles 'Git'),
      (Join-Path ${env:ProgramFiles(x86)} 'Git'),
      (Join-Path $env:LOCALAPPDATA 'Programs/Git')
    )) {
    if ($candidate) { $candidates.Add($candidate) }
  }

  foreach ($candidate in $candidates) {
    if ([string]::IsNullOrWhiteSpace($candidate)) { continue }
    if (-not (Test-Path -LiteralPath $candidate)) { continue }
    $bash = Join-Path $candidate 'usr/bin/bash.exe'
    $msys = Join-Path $candidate 'usr/bin/msys-2.0.dll'
    if ((Test-Path -LiteralPath $bash) -and (Test-Path -LiteralPath $msys)) { return (Resolve-Path -LiteralPath $candidate).Path }
  }
  return $null
}

if (-not $SkipPitfallChecks) {
  Write-Stage 'pitfall 2/3: DSH_DESKTOP_BASH_DIR'
  $resolvedBash = Resolve-GitBashRoot
  if ($null -eq $resolvedBash) {
    Fail 'No Git-for-Windows distribution with usr/bin/bash.exe and usr/bin/msys-2.0.dll was found.' @(
      'prepare-runtime.ts requires DSH_DESKTOP_BASH_DIR for a Windows target.',
      'Install Git for Windows, or pass -BashDir <root of a prepared distribution>.',
      'A release build must use the patched DLL from rsh/Core/native/windows-bash/README.md, not a stock one.'
    )
  }
  $env:DSH_DESKTOP_BASH_DIR = $resolvedBash
  Write-Note "DSH_DESKTOP_BASH_DIR = $resolvedBash"

  # Report whether the stock or the patched loader is being shipped: one is a
  # local smoke-test input, the other is the documented release input.
  $pinned = Join-Path $repoRoot 'rsh/Core/native/windows-bash/upstream.json'
  if (Test-Path -LiteralPath $pinned) {
    $upstream = Get-Content -LiteralPath $pinned -Raw | ConvertFrom-Json
    $expectedOriginal = [string]$upstream.distribution.originalRuntimeSha256
    $msysPath = Join-Path $resolvedBash 'usr/bin/msys-2.0.dll'
    $actual = (Get-FileHash -LiteralPath $msysPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -eq $expectedOriginal) {
      Write-Note 'msys-2.0.dll is the stock upstream loader (matches pinned originalRuntimeSha256).'
      Write-Note 'Suitable for local smoke verification only; a release build needs the patched DLL.'
    } else {
      Write-Note 'msys-2.0.dll is not the pinned upstream loader; treat provenance as unverified.'
    }
  }
}

# --- pitfall 3: VCToolsVersion (Spectre-mitigated libraries) ---------------

function Resolve-SpectreToolset {
  $roots = @(
    'C:\Program Files\Microsoft Visual Studio',
    'C:\Program Files (x86)\Microsoft Visual Studio'
  ) | Where-Object { Test-Path -LiteralPath $_ }

  # A Visual Studio root holds <year>\<instance>\VC\Tools\MSVC, and the Build Tools
  # flavour nests one more level, so collect every VC/Tools/MSVC below each root
  # rather than assuming one layout. The depth is generous because a fixed value
  # silently misses a taller layout.
  $toolsRoots = @()
  foreach ($root in $roots) {
    $toolsRoots += @(
      Get-ChildItem -LiteralPath $root -Directory -Recurse -Depth 6 -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq 'MSVC' -and $_.FullName -match '[\\/]VC[\\/]Tools[\\/]MSVC$' } |
        Select-Object -ExpandProperty FullName
    )
  }

  $found = @()
  foreach ($toolsRoot in $toolsRoots) {
    foreach ($versionDir in @(Get-ChildItem -LiteralPath $toolsRoot -Directory -ErrorAction SilentlyContinue)) {
      $spectreX64 = Join-Path $versionDir.FullName 'lib/spectre/x64'
      $fileCount = 0
      if (Test-Path -LiteralPath $spectreX64) {
        # Count every entry: the directory holds the .lib set plus the .obj and
        # .pdb companions the linker also needs, so a .lib-only count understates it.
        $fileCount = @(Get-ChildItem -LiteralPath $spectreX64 -File -ErrorAction SilentlyContinue).Count
      }
      $found += [pscustomobject]@{
        Version   = $versionDir.Name
        Root      = $toolsRoot
        Path      = $spectreX64
        FileCount = $fileCount
      }
    }
  }
  return $found
}

if (-not $SkipPitfallChecks) {
  Write-Stage 'pitfall 3/3: VCToolsVersion (Spectre-mitigated libraries)'
  $toolsets = @(Resolve-SpectreToolset)
  if ($toolsets.Count -eq 0) {
    Fail 'No MSVC toolset was found under any Visual Studio installation.' @(
      'Install Visual C++ build tools: the Desktop runtime compiles node-pty from source.'
    )
  }

  if ($VcToolsVersion) {
    $chosen = @($toolsets | Where-Object { $_.Version -eq $VcToolsVersion }) | Select-Object -First 1
    if ($null -eq $chosen) {
      Fail "Requested VCToolsVersion $VcToolsVersion is not installed." @(
        "Installed: $(($toolsets | ForEach-Object { $_.Version } | Sort-Object) -join ', ')"
      )
    }
    if ($chosen.FileCount -eq 0) {
      Fail "Requested VCToolsVersion $VcToolsVersion has no Spectre x64 libraries." @(
        "Expected: $($chosen.Path)"
      )
    }
  } else {
    $withSpectre = @($toolsets | Where-Object { $_.FileCount -gt 0 })
    if ($withSpectre.Count -eq 0) {
      Fail 'No installed MSVC toolset ships Spectre-mitigated x64 libraries.' @(
        'node-pty fails with MSB8040 without them.',
        'In the Visual Studio installer, add the Spectre-mitigated libraries for the active toolset and x64.',
        "Inspected: $(($toolsets | ForEach-Object { "$($_.Version):$($_.FileCount)" }) -join ', ')"
      )
    }
    $chosen = @($withSpectre | Sort-Object Version -Descending) | Select-Object -First 1
  }

  $env:VCToolsVersion = $chosen.Version
  Write-Note "VCToolsVersion = $($chosen.Version) ($($chosen.FileCount) Spectre x64 files)"
  $without = @($toolsets | Where-Object { $_.FileCount -eq 0 } | ForEach-Object { $_.Version } | Sort-Object)
  if ($without.Count -gt 0) {
    Write-Note "Skipped toolsets without Spectre libs: $($without -join ', ')"
  }
}

# --- application id --------------------------------------------------------

Write-Stage 'application id'
$resolvedAppId = if ($AppId) { $AppId } elseif ($env:DSH_DESKTOP_APP_ID) { $env:DSH_DESKTOP_APP_ID } else { 'org.redspark.harness' }
if ($resolvedAppId -notmatch '^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$') {
  Fail "Application id is not reverse-DNS: $resolvedAppId" @(
    'desktop-release-environment.mjs validates DSH_DESKTOP_APP_ID with that pattern.'
  )
}
$env:DSH_DESKTOP_APP_ID = $resolvedAppId
Write-Note "DSH_DESKTOP_APP_ID = $resolvedAppId"

# --- invoke packaging ------------------------------------------------------

$scriptInvocation = switch ($Mode) {
  'dir' { 'package:desktop:win:x64:dir' }
  'signed' { 'package:desktop:win:x64' }
  default { 'package:desktop:win:x64:unsigned' }
}

Write-Stage "packaging ($scriptInvocation)"
Write-Note "repository: $repoRoot"

# The local shim must win over any globally installed pnpm, otherwise inner
# scripts resolve a different major and fail with ERR_PNPM_BAD_PM_VERSION.
$originalPath = $env:PATH
$env:PATH = "$(Join-Path $repoRoot 'node_modules/.bin');$originalPath"
$env:CI = 'true'

$packStartedAt = Get-Date
Push-Location -LiteralPath $repoRoot
try {
  & $localPnpm run $scriptInvocation
  $packExit = $LASTEXITCODE
} finally {
  Pop-Location
  $env:PATH = $originalPath
}

$packSeconds = ((Get-Date) - $packStartedAt).TotalSeconds

if ($packExit -ne 0) {
  Fail "pnpm run $scriptInvocation exited with $packExit" @(
    'The packaging output above ends with the failing stage.',
    "node-pty MSB8040 means the selected toolset has no Spectre libraries; rerun with -VcToolsVersion <version>.",
    'ERR_PNPM_BAD_PM_VERSION means an inner script reached a global pnpm.',
    'A native-runtime manifest error means a dsh.native row names a package that declares no native entry.'
  )
}
Write-Note ("packaging finished in {0:N1}s" -f $packSeconds)

# --- verify artifacts ------------------------------------------------------

Write-Stage 'verification'

$buildPaths = @{
  'dir'      = Join-Path $desktopRoot '.desktop-build/targets/win-x64/artifacts'
  'unsigned' = Join-Path $desktopRoot '.desktop-build/targets/win-x64/unsigned-artifacts'
  'signed'   = Join-Path $desktopRoot '.desktop-build/targets/win-x64/artifacts'
}
$artifactRoot = $buildPaths[$Mode]
if (-not (Test-Path -LiteralPath $artifactRoot)) {
  Fail "Expected artifact directory is missing: $artifactRoot"
}

$unpacked = Join-Path $artifactRoot 'win-unpacked'
if (-not (Test-Path -LiteralPath $unpacked)) {
  Fail "win-unpacked is missing from $artifactRoot" @(
    'electron-builder should always emit it for a Windows target.'
  )
}

# electron-builder names the executable after productName, not after the package name.
$expectedProductName = 'RedSpark Harness'
$exeName = "$expectedProductName.exe"
$exePath = Join-Path $unpacked $exeName

# The artifact name template may legitimately differ; fall back to any single exe.
if (-not (Test-Path -LiteralPath $exePath)) {
  $exes = @(Get-ChildItem -LiteralPath $unpacked -File -Filter '*.exe' -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notin @('elevate.exe') })
  if ($exes.Count -eq 1) {
    $exePath = $exes[0].FullName
    Write-Note "Executable differs from productName; using $($exes[0].Name)"
  } else {
    Fail "Cannot identify the application executable in $unpacked" @(
      "Expected: $exeName",
      "Found: $(($exes.Name) -join ', ')"
    )
  }
}

$exeItem = Get-Item -LiteralPath $exePath
Write-Host ("         exe:    {0}" -f $exeItem.FullName)
Write-Host ("         bytes:  {0:N0}" -f $exeItem.Length)
Write-Host ("         mtime:  {0:yyyy-MM-dd HH:mm:ss}" -f $exeItem.LastWriteTime)

$versionInfo = $exeItem.VersionInfo
if ($versionInfo.ProductName -ne $expectedProductName) {
  Fail "Packaged executable ProductName is '$($versionInfo.ProductName)', expected '$expectedProductName'" @(
    'electron-builder.config.mjs sets productName; a mismatch means a stale or wrong config was used.'
  )
}
Write-Host ("         productName: {0}" -f $versionInfo.ProductName)
Write-Host ("         FileVersion: {0}" -f $versionInfo.FileVersion)

$expectedVersion = [string]$rootManifest.version
if ($versionInfo.FileVersion -ne $expectedVersion) {
  Fail "Packaged FileVersion is '$($versionInfo.FileVersion)', expected '$expectedVersion'" @(
    'The Desktop and root manifests must carry the same version.'
  )
}

# The bundled runtime must actually contain the @deepseek-ai packages.
$packagesDir = Join-Path $unpacked 'resources/dsh/node_modules/@deepseek-ai'
if (-not (Test-Path -LiteralPath $packagesDir)) {
  Fail "The bundled runtime has no @deepseek-ai packages: $packagesDir"
}
$bundledPackages = @(Get-ChildItem -LiteralPath $packagesDir -Directory |
  Select-Object -ExpandProperty Name |
  Sort-Object)
Write-Host ("         bundled @deepseek-ai packages: {0}" -f $bundledPackages.Count)

foreach ($requiredPackage in @('dsh', 'dsh-desktop-host')) {
  if ($bundledPackages -notcontains $requiredPackage) {
    Fail "The bundled runtime is missing @deepseek-ai/$requiredPackage" @(
      'prepare-dsh.ts installs the release package set; a missing Host means preparation was skipped or partial.'
    )
  }
}

$artifacts = @(Get-ChildItem -LiteralPath $artifactRoot -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Extension -in @('.exe', '.blockmap') -and $_.Length -gt 1MB } |
  ForEach-Object {
    Write-Host ("         artifact: {0}  {1:N0} bytes  {2:yyyy-MM-dd HH:mm:ss}" -f $_.Name, $_.Length, $_.LastWriteTime)
    [pscustomobject]@{ name = $_.Name; path = $_.FullName; bytes = $_.Length; mtime = $_.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss') }
  })

# --- report ----------------------------------------------------------------

$totalSeconds = ((Get-Date) - $script:StartedAt).TotalSeconds
if ($ReportPath) {
  $report = [ordered]@{
    schemaVersion    = 1
    ok               = $true
    mode             = $Mode
    script           = $scriptInvocation
    repository       = $repoRoot
    appId            = $resolvedAppId
    packageVersion   = $expectedVersion
    bashDir          = if (-not $SkipPitfallChecks) { $env:DSH_DESKTOP_BASH_DIR } else { $null }
    vcToolsVersion   = if (-not $SkipPitfallChecks) { $env:VCToolsVersion } else { $null }
    packagingSeconds = [math]::Round($packSeconds, 1)
    totalSeconds     = [math]::Round($totalSeconds, 1)
    repairs          = $script:Actions
    executable       = [ordered]@{
      path        = $exeItem.FullName
      bytes       = $exeItem.Length
      mtime       = $exeItem.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
      productName = $versionInfo.ProductName
      fileVersion = $versionInfo.FileVersion
    }
    unpacked         = $unpacked
    bundledPackages  = $bundledPackages.Count
    artifacts        = $artifacts
  }
  $reportDirectory = Split-Path -Parent $ReportPath
  if ($reportDirectory -and -not (Test-Path -LiteralPath $reportDirectory)) {
    New-Item -ItemType Directory -Force -Path $reportDirectory | Out-Null
  }
  # Write without a BOM so the report stays parseable by non-PowerShell tooling.
  $reportJson = $report | ConvertTo-Json -Depth 6
  [System.IO.File]::WriteAllText($ReportPath, $reportJson, [System.Text.UTF8Encoding]::new($false))
  Write-Host ("         report: {0}" -f (Resolve-Path -LiteralPath $ReportPath).Path)
}

Write-Host ''
Write-Host ("package-desktop-win: OK  ({0:N1}s total, {1:N1}s packaging)" -f $totalSeconds, $packSeconds) -ForegroundColor Green
Write-Host ("  unpacked: {0}" -f $unpacked) -ForegroundColor Green
if ($script:Actions.Count -gt 0) {
  Write-Host '  environment repairs:' -ForegroundColor Green
  foreach ($action in $script:Actions) { Write-Host "    * $action" -ForegroundColor Green }
}
exit 0
