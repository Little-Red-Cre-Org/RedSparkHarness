param([ValidateSet('desktop', 'web', 'acceptance')][string]$Mode = 'acceptance')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $projectRoot
$nodeBinary = (Get-Command node.exe -ErrorAction Stop).Source
$env:Path = (Split-Path $nodeBinary) + ';' + (Join-Path $projectRoot 'node_modules\.bin') + ';' + $env:Path
$env:DSH_DESKTOP_OPEN_DEVTOOLS = '0'
$logRoot = Join-Path $projectRoot '.git\redspark-local'
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

if ($Mode -eq 'acceptance') {
    Start-Process (Join-Path $projectRoot 'ACCEPTANCE.html')
    & $PSCommandPath -Mode web
    & $PSCommandPath -Mode desktop
    exit
}

if ($Mode -eq 'web') {
    $webLogs = @((Join-Path $logRoot 'web.log'), (Join-Path $projectRoot '.local-web.log'), (Join-Path $projectRoot '.git\local-web.log'))
    foreach ($log in $webLogs) {
        if (!(Test-Path -LiteralPath $log)) { continue }
        $match = Select-String -LiteralPath $log -Pattern 'dsh web: (http://\S+)' | Select-Object -Last 1
        if (!$match) { continue }
        $url = $match.Matches[0].Groups[1].Value
        try { $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 3 } catch { continue }
        if ($response.StatusCode -eq 200) { Start-Process $url; exit }
    }
    Start-Process -FilePath $nodeBinary -ArgumentList @('--import','tsx/esm','apps/cli/src/bin.ts','web') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logRoot 'web.log') -RedirectStandardError (Join-Path $logRoot 'web.err.log')
} else {
    Start-Process -FilePath $nodeBinary -ArgumentList @('--import','tsx/esm','apps/desktop/scripts/dev.ts','--skip-build') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logRoot 'desktop.log') -RedirectStandardError (Join-Path $logRoot 'desktop.err.log')
}
