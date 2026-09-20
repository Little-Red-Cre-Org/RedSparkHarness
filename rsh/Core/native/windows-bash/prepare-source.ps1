# Prepare the pinned upstream source without modifying an existing checkout.
param(
    [Parameter(Mandatory = $true)][string]$Archive,
    [Parameter(Mandatory = $true)][string]$Destination
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$manifest = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'upstream.json') | ConvertFrom-Json
$archivePath = (Resolve-Path -LiteralPath $Archive).Path
$patchPath = Join-Path $PSScriptRoot $manifest.patch
$destinationPath = [System.IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $destinationPath) {
    throw "Destination must not exist: $destinationPath"
}
foreach ($inputFile in @(
    @{ Path = $archivePath; Expected = $manifest.archiveSha256 },
    @{ Path = $patchPath; Expected = $manifest.patchSha256 }
)) {
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try {
        $stream = [System.IO.File]::OpenRead($inputFile.Path)
        try {
            $actual = [System.BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '')
        } finally { $stream.Dispose() }
    } finally { $algorithm.Dispose() }
    if ($actual -ine $inputFile.Expected) {
        throw "SHA-256 mismatch: $($inputFile.Path)"
    }
}
$tar = (Get-Command tar.exe -ErrorAction Stop).Source
$git = (Get-Command git.exe -ErrorAction Stop).Source
# CreateDirectory alone permits an existing directory; New-Item without Force rejects it.
$null = New-Item -ItemType Directory -Path $destinationPath
& $tar -xf $archivePath -C $destinationPath
if ($LASTEXITCODE -ne 0) { throw 'Source extraction failed; partial destination retained for inspection' }
$sourcePath = Join-Path $destinationPath "msys2-runtime-$($manifest.revision)"
if (-not (Test-Path -LiteralPath (Join-Path $sourcePath 'winsup/cygwin/sigproc.cc'))) {
    throw 'Pinned source archive has an unexpected root'
}
& $git -C $sourcePath apply --check $patchPath
if ($LASTEXITCODE -ne 0) { throw 'Runtime patch validation failed' }
& $git -C $sourcePath apply $patchPath
if ($LASTEXITCODE -ne 0) { throw 'Runtime patch application failed' }
& $git -C $sourcePath apply --reverse --check $patchPath
if ($LASTEXITCODE -ne 0) { throw 'Applied runtime patch verification failed' }
Write-Output $sourcePath
