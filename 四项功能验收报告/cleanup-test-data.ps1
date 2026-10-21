$ErrorActionPreference = 'Stop'
$base = 'E:\redsparkHarness'
$output = Join-Path $base 'RSH-feature\四项功能验收报告'
$imageHome = Join-Path $base 'RedSparkHarness-image-understanding\output\playwright\feature01-home'
$groupsHome = Join-Path $base 'RedSparkHarness-tool-groups\output\playwright\tool-groups-home'
$browserRoot = Join-Path $base 'RedSparkHarness-zero-budget-next\.cache\zero-budget-validation'
$ideTestData = 'C:\Users\12148\AppData\Local\RedSparkHarness\ide\data-zero-budget-next'
$roots = @($imageHome, $groupsHome, $ideTestData)
$roots += @('chrome-profile','chrome-profile-1791604149353','chrome-profile-1791620259761','chrome-profile-1791620405369','chrome-profile-1791620673746','chrome-profile-1791623549615','chrome-profile-1791631827747','chrome-profile-1791631942663','chrome-native-host','desktop-home','desktop-project','native-desktop-project','native-electron','native-ide-home','workspace') | ForEach-Object { Join-Path $browserRoot $_ }
$script:fileCount = 0
$script:linkCount = 0
$script:bytes = 0L
function Remove-OwnedTree([string]$path, [string]$root) {
    $full = [IO.Path]::GetFullPath($path)
    if ($full -ne $root -and -not $full.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "Outside approved test root: $full" }
    $item = Get-Item -LiteralPath $full -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        if ($item.PSIsContainer) { [IO.Directory]::Delete($full, $false) } else { [IO.File]::Delete($full) }
        $script:linkCount++
        return
    }
    if ($item.PSIsContainer) {
        foreach ($child in @(Get-ChildItem -LiteralPath $full -Force)) {
            try { Remove-OwnedTree $child.FullName $root }
            catch { Write-Warning ('Pending locked item: ' + $child.FullName) }
        }
        Remove-Item -LiteralPath $full -Force
    } else {
        $script:bytes += $item.Length
        Remove-Item -LiteralPath $full -Force
        $script:fileCount++
    }
}
$removed = @()
$failures = @()
foreach ($path in $roots) {
    $root = [IO.Path]::GetFullPath($path)
    $allowed = ($root -eq $imageHome) -or ($root -eq $groupsHome) -or ($root -eq $ideTestData) -or ($root.StartsWith($browserRoot + '\', [StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetDirectoryName($root) -eq $browserRoot)
    if (-not $allowed) { throw "Unapproved root: $root" }
    if (Test-Path -LiteralPath $root) {
        try { Remove-OwnedTree $root $root; $removed += $root }
        catch { $failures += @{ root = $root; error = $_.Exception.Message } }
    }
}
foreach ($name in @('user-test-server.pid','user-test-url.txt')) {
    $file = Join-Path $base ('RedSparkHarness-image-understanding\output\playwright\' + $name)
    if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force; $script:fileCount++ }
}
$result = [ordered]@{ time = (Get-Date -Format o); verifiedCleanupRoots = $roots; removedRootsThisPass = $removed; filesThisPass = $script:fileCount; junctionsUnlinkedThisPass = $script:linkCount; bytesThisPass = $script:bytes; note = 'Counts cover final cleanup pass only; initial pass was interrupted by a closing Chrome file lock.'; rootsStillPresent = @($roots | Where-Object { Test-Path -LiteralPath $_ }); failures = $failures; preserved = @('source code','regression fixtures','acceptance reports and screenshots','real user profiles and sessions','main worktree','backups') }
$result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $output '测试数据清理清单.json') -Encoding utf8
$result | ConvertTo-Json -Depth 5
