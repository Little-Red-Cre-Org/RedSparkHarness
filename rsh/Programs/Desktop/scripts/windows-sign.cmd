@echo off
setlocal DisableDelayedExpansion
set "signTool=%RSH_DESKTOP_WINDOWS_SIGNTOOL%"
set "certificateFile=%RSH_DESKTOP_WINDOWS_CER_FILE%"
set "tokenPin=%RSH_DESKTOP_WINDOWS_TOKEN_PIN%"
set "keyContainer=%RSH_DESKTOP_WINDOWS_KEY_CONTAINER%"
set "targetFile=%RSH_DESKTOP_WINDOWS_SIGN_TARGET%"
set "appendSignature="
if "%RSH_DESKTOP_WINDOWS_SIGN_APPEND%"=="1" set "appendSignature=/as"
set "RSH_DESKTOP_WINDOWS_SIGNTOOL="
set "RSH_DESKTOP_WINDOWS_CER_FILE="
set "RSH_DESKTOP_WINDOWS_TOKEN_PIN="
set "RSH_DESKTOP_WINDOWS_KEY_CONTAINER="
set "RSH_DESKTOP_WINDOWS_SIGN_TARGET="
set "RSH_DESKTOP_WINDOWS_SIGN_APPEND="
set "signTool=" & set "certificateFile=" & set "tokenPin=" & set "keyContainer=" & set "targetFile=" & set "appendSignature=" & "%signTool%" sign /v /fd sha256 /f "%certificateFile%" /kc "[{{%tokenPin%}}]=%keyContainer%" /csp "eToken Base Cryptographic Provider" %appendSignature% /tr http://timestamp.digicert.com /td sha256 "%targetFile%"
exit /b %errorlevel%
