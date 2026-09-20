[CmdletBinding()]
param(
  [string]$Destination = (Join-Path $env:APPDATA 'npm\rsh.cmd')
)

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$node = Get-Command node -ErrorAction Stop
$tsxLoader = Join-Path $projectRoot 'node_modules\tsx\dist\esm\index.mjs'
$targetDirectory = Split-Path -Parent $Destination

if (-not (Test-Path -LiteralPath $tsxLoader)) {
  throw "rsh installer needs the checkout dependencies. Run pnpm install in $projectRoot first."
}

$tsxLoaderUrl = [Uri]::new($tsxLoader).AbsoluteUri
$tsxConfig = Join-Path $projectRoot 'tsconfig.host.json'

if (Test-Path -LiteralPath $Destination) {
  throw "rsh installer refused to replace existing command: $Destination"
}

New-Item -ItemType Directory -Force -Path $targetDirectory | Out-Null
$wrapper = "@echo off`r`nsetlocal`r`nset `"TSX_TSCONFIG_PATH=$tsxConfig`"`r`n`"$($node.Source)`" --import `"$tsxLoaderUrl`" `"$projectRoot\apps\cli\src\bin.ts`" --profile rsh %*`r`n"
[System.IO.File]::WriteAllText($Destination, $wrapper, [System.Text.UTF8Encoding]::new($false))
Write-Output "Installed rsh shim: $Destination"
