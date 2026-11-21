param([ValidateSet('desktop', 'acceptance')][string]$Mode = 'acceptance')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location -LiteralPath $projectRoot
$nodeBinary = (Get-Command node.exe -ErrorAction Stop).Source
$env:Path = (Split-Path $nodeBinary) + ';' + (Join-Path $projectRoot 'node_modules\.bin') + ';' + $env:Path
$env:RSH_DESKTOP_OPEN_DEVTOOLS = '0'
$logRoot = Join-Path $projectRoot '.git\redspark-local'
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

if ($Mode -eq 'acceptance') {
    Start-Process (Join-Path $projectRoot 'ACCEPTANCE.html')
    & $PSCommandPath -Mode desktop
    exit
}

Start-Process -FilePath $nodeBinary -ArgumentList @('--import','tsx/esm','rsh/Programs/Desktop/scripts/dev.ts','--skip-build') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logRoot 'desktop.log') -RedirectStandardError (Join-Path $logRoot 'desktop.err.log')
