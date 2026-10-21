$ErrorActionPreference='Stop'
$parent='E:\redsparkHarness\RedSparkHarness-zero-budget-next\.cache\zero-budget-validation'
# Exact disposable directories observed in this task's Chrome launch logs.
$names=@('chrome-profile-1791696555462','chrome-profile-1791696587181','chrome-profile-1791696712991','chrome-profile-1791696746461','chrome-profile-1791696802102','chrome-profile-1791696855355','chrome-profile-1791696892825','chrome-profile-1791696965472','chrome-profile-1791697000791','chrome-profile-1791697051405','chrome-profile-1791697193658','chrome-profile-1791697370565','chrome-profile-1791697410167','chrome-profile-1791697479595','chrome-native-host')
$script:locked=@()
function Remove-TestItem([string]$itemPath,[string]$root) {
 $full=[IO.Path]::GetFullPath($itemPath)
 if($full -ne $root -and -not $full.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Path outside test root'}
 $item=Get-Item -LiteralPath $full -Force
 if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Unexpected link; not followed'}
 if($item.PSIsContainer){
  foreach($child in @(Get-ChildItem -LiteralPath $full -Force)){
   try{Remove-TestItem $child.FullName $root}catch{$script:locked+= $child.FullName}
  }
  [IO.Directory]::Delete($full,$false)
 }else{Remove-Item -LiteralPath $full -Force}
}
$roots=@()
foreach($name in $names){
 $root=[IO.Path]::GetFullPath((Join-Path $parent $name))
 if([IO.Path]::GetDirectoryName($root) -ne $parent){throw 'Unexpected test root'}
 $roots+=$root
 if(Test-Path -LiteralPath $root){try{Remove-TestItem $root $root}catch{$script:locked+=$root}}
}
$result=[ordered]@{time=(Get-Date -Format o);targets=$roots;remaining=@($roots|Where-Object{Test-Path -LiteralPath $_});locked=$script:locked;registrationPresent=(Test-Path 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.redspark.harness.readonly')}
$result|ConvertTo-Json -Depth 4|Set-Content -LiteralPath (Join-Path $PSScriptRoot '2026-10-11-清理结果.json') -Encoding utf8
$result|ConvertTo-Json -Depth 4
