# Local deployment task: preserve user changes, fast-forward main, build and reopen desktop.
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$projectRoot = 'E:\redsparkHarness\RedSparkHarness'
$desktopRoot = Join-Path $projectRoot 'rsh\Programs\Desktop'
$stateFile = Join-Path $PSScriptRoot 'deployed-commit.txt'
$logFile = Join-Path $PSScriptRoot 'hourly-update.log'
$failureFile = Join-Path $PSScriptRoot 'hourly-update-last-failure.txt'
$node = 'C:\Program Files\nodejs\node.exe'
$git = 'C:\Program Files\Git\cmd\git.exe'
$pnpm = 'C:\Users\12148\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd'
$env:PATH = (Split-Path $node) + ';' + (Split-Path $git) + ';' + (Split-Path $pnpm) + ';' + $env:PATH
$env:pnpm_config_verify_deps_before_run = 'false'
$env:GIT_TERMINAL_PROMPT = '0'
$env:GCM_INTERACTIVE = 'never'

function Invoke-Checked {
    param([string]$File, [string[]]$Arguments)
    & $File @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$File $($Arguments -join ' ') exited with code $LASTEXITCODE" }
}

function Close-RshDesktop {
    $running = @(Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" |
        Where-Object { $_.CommandLine -like "*$desktopRoot" -and $_.CommandLine -notlike '*--type=*' })
    foreach ($item in $running) {
        $process = Get-Process -Id $item.ProcessId
        if (-not $process.CloseMainWindow()) { throw 'Desktop did not accept a graceful close; update stopped.' }
        if (-not $process.WaitForExit(30000)) { throw 'Desktop is still running; update stopped without forcing it closed.' }
    }
}

Set-Location -LiteralPath $projectRoot
Start-Transcript -LiteralPath $logFile -Force | Out-Null
try {
    $branch = Invoke-Checked $git @('branch', '--show-current')
    if ($branch -ne 'main') { throw 'Current branch is not main; automatic update stopped.' }
    $uri = [uri]'https://github.com/'
    $proxy = [System.Net.WebRequest]::GetSystemWebProxy().GetProxy($uri)
    $gitOptions = @()
    if ($proxy -ne $uri) {
        $gitOptions = @('-c', "http.proxy=$($proxy.AbsoluteUri)")
        $env:HTTPS_PROXY = $proxy.AbsoluteUri
        $env:HTTP_PROXY = $proxy.AbsoluteUri
        $env:NODE_USE_ENV_PROXY = '1'
    }
    Invoke-Checked $git ($gitOptions + @('fetch', 'origin', 'main'))
    $head = Invoke-Checked $git @('rev-parse', 'HEAD')
    $target = Invoke-Checked $git @('rev-parse', 'origin/main')
    if ($head -ne $target) {
        $counts = (Invoke-Checked $git @('rev-list', '--left-right', '--count', "$head...$target")) -split '\s+'
        if ([int]$counts[0] -gt 0) {
            if ([int]$counts[1] -gt 0) {
                throw 'Local main and origin/main have diverged; automatic update stopped to preserve local commits.'
            }
            Write-Output "Update skipped: local main is ahead of origin/main by $($counts[0]) commits."
            if (Test-Path -LiteralPath $failureFile) { Remove-Item -LiteralPath $failureFile }
            exit 0
        }
        # Git refuses overlapping local edits and untracked files; never stash, reset, or clean here.
        Invoke-Checked $git @('merge', '--ff-only', $target)
    }
    if ((Test-Path -LiteralPath $stateFile) -and ((Get-Content -LiteralPath $stateFile -Raw).Trim() -eq $target)) {
        Write-Output "Already deployed: $target"
    } else {
        Close-RshDesktop
        Invoke-Checked $pnpm @('install', '--frozen-lockfile', '--registry=https://registry.npmjs.org')
        Invoke-Checked $pnpm @('run', 'build')
        Invoke-Checked $pnpm @('--filter', '@deepseek-ai/dsh-desktop', 'run', 'build')
        # A desktop opened during the build still holds the previous client assets.
        Close-RshDesktop
        $shortcutPath = 'D:\RedSpark Harness.lnk'
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
        $shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $PSScriptRoot 'start-redspark.ps1') + '"'
        $shortcut.WorkingDirectory = $projectRoot
        $shortcut.IconLocation = (Join-Path $desktopRoot 'renderer\redspark.ico') + ',0'
        $shortcut.Save()
        Start-Process -FilePath $shortcutPath
        $ready = $false
        for ($attempt = 0; $attempt -lt 45; $attempt++) {
            Start-Sleep -Seconds 2
            try {
                $pages = Invoke-RestMethod 'http://127.0.0.1:9222/json/list' -TimeoutSec 2
                $hosts = Invoke-RestMethod 'http://127.0.0.1:9230/json/list' -TimeoutSec 2
            } catch {
                # Inspector endpoints are unavailable while Electron and its Host start.
                continue
            }
            $window = @(Get-Process electron -ErrorAction SilentlyContinue |
                Where-Object { $_.MainWindowTitle -like '*RedSpark Harness' -and $_.Responding -and $_.Path.StartsWith($projectRoot, [StringComparison]::OrdinalIgnoreCase) })
            if (@($pages | Where-Object { $_.url -eq 'dsh-app://app/index.html' }).Count -and @($hosts).Count -and $window.Count) {
                $ready = $true
                break
            }
        }
        if (-not $ready) { throw 'Desktop or Host did not become ready; see desktop-launch.err.log.' }
        Set-Content -LiteralPath $stateFile -Value $target -Encoding utf8
        Write-Output "Deployed and opened: $target"
        $null = $shell.Popup(('RSH 已更新代码和桌面端：' + $target.Substring(0, 8)), 10, 'RSH 自动更新完成', 64)
    }
    if (Test-Path -LiteralPath $failureFile) { Remove-Item -LiteralPath $failureFile }
} catch {
    $failure = $_.Exception.Message
    Write-Output "UPDATE FAILED: $failure"
    if ((Test-Path -LiteralPath $failureFile) -and ((Get-Content -LiteralPath $failureFile -Raw).TrimEnd() -eq $failure)) {
        Write-Output 'Repeated failure: notification suppressed; see this log for details.'
    } else {
        $shell = New-Object -ComObject WScript.Shell
        $null = $shell.Popup("RSH 自动更新未完成：$failure`n日志：$logFile", 20, 'RSH 自动更新需要处理', 48)
        Set-Content -LiteralPath $failureFile -Value $failure -Encoding utf8
    }
    exit 1
} finally {
    Stop-Transcript | Out-Null
}
