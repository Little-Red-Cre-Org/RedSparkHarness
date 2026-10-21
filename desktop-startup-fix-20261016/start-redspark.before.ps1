$ErrorActionPreference = 'Stop'
$projectRoot = 'E:\redsparkHarness\RedSparkHarness'
$desktopRoot = Join-Path $projectRoot 'rsh\Programs\Desktop'
$oldHome = Join-Path $projectRoot 'apps\desktop\.desktop-build\development\home'
$shell = New-Object -ComObject WScript.Shell

try {
    if (-not (Test-Path -LiteralPath (Join-Path $oldHome 'sessions'))) {
        throw "找不到原桌面端会话资料：$oldHome"
    }
    $running = Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" |
        Where-Object { $_.CommandLine -like "*$desktopRoot" -and $_.CommandLine -notlike '*--type=*' } |
        Where-Object { $null -ne (Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue) } |
        Select-Object -First 1
    if ($running -and $shell.AppActivate($running.ProcessId)) {
        exit 0
    }

    $node = (Get-Command node.exe -ErrorAction Stop).Source
    $tsx = Join-Path $projectRoot 'node_modules\tsx\dist\cli.mjs'
    $env:DSH_HOME = $oldHome
    $env:pnpm_config_verify_deps_before_run = 'false'
    $env:DSH_DESKTOP_OPEN_DEVTOOLS = '0'
    $env:ELECTRON_RUN_AS_NODE = $null
    $uri = [uri]'https://github.com/'
    $proxy = [System.Net.WebRequest]::GetSystemWebProxy().GetProxy($uri)
    if ($proxy -ne $uri) {
        $env:HTTPS_PROXY = $proxy.AbsoluteUri
        $env:HTTP_PROXY = $proxy.AbsoluteUri
        $env:NODE_USE_ENV_PROXY = '1'
    }

    $arguments = '"' + $tsx + '" rsh/Programs/Desktop/scripts/dev.ts --skip-build'
    $log = Join-Path $PSScriptRoot 'desktop-launch.log'
    $errorLog = Join-Path $PSScriptRoot 'desktop-launch.err.log'
    $child = Start-Process -FilePath $node -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError $errorLog -Wait -PassThru
    if ($child.ExitCode -ne 0) { throw "桌面端启动失败，请查看错误日志：$errorLog" }
} catch {
    $null = $shell.Popup($_.Exception.Message, 0, 'RedSpark Harness', 16)
    exit 1
}
