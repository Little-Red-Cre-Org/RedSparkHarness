# Assemble an isolated PortableGit tree; the supplied DLL must be independently validated.
param(
    [Parameter(Mandatory = $true)][string]$Archive,
    [Parameter(Mandatory = $true)][string]$RuntimeDll,
    [Parameter(Mandatory = $true)][string]$SevenZip,
    [Parameter(Mandatory = $true)][string]$Destination
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
function Get-Sha256([string]$Path) {
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try {
        $stream = [System.IO.File]::OpenRead($Path)
        try { return [System.BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
        finally { $stream.Dispose() }
    } finally { $algorithm.Dispose() }
}
$manifest = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'upstream.json') | ConvertFrom-Json
$archivePath = (Resolve-Path -LiteralPath $Archive).Path
$dllPath = (Resolve-Path -LiteralPath $RuntimeDll).Path
$extractor = (Resolve-Path -LiteralPath $SevenZip).Path
$destinationPath = [System.IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $destinationPath) { throw "Destination must not exist: $destinationPath" }
if ((Get-Sha256 $archivePath) -ne $manifest.distribution.archiveSha256) { throw 'PortableGit archive SHA-256 mismatch' }
$dllHash = Get-Sha256 $dllPath
$null = New-Item -ItemType Directory -Path $destinationPath
& $extractor x $archivePath "-o$destinationPath" -y
if ($LASTEXITCODE -ne 0) { throw 'PortableGit extraction failed; partial destination retained for inspection' }
$targetDll = Join-Path $destinationPath 'usr/bin/msys-2.0.dll'
if ((Get-Sha256 $targetDll) -ne $manifest.distribution.originalRuntimeSha256) { throw 'Unexpected original MSYS runtime' }
Copy-Item -LiteralPath $dllPath -Destination $targetDll
if ((Get-Sha256 $targetDll) -ne $dllHash) { throw 'Copied MSYS runtime SHA-256 mismatch' }
Write-Output $destinationPath
