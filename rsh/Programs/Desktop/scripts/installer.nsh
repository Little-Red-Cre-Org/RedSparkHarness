!include "LogicLib.nsh"

!macro customInstall
  Push $0
  StrCpy $0 0
  ${If} ${Errors}
    StrCpy $0 1
  ${EndIf}
  ; Finish can launch the app while NSIS removes its remaining plugin directory.
  RMDir /r "$PLUGINSDIR\7z-out"
  ${If} $0 == 1
    SetErrors
  ${Else}
    ClearErrors
  ${EndIf}
  Pop $0
!macroend

!macro customUnInstall
  ; Upgrades retain electron-builder's atomic move and rollback path.
  ${IfNot} ${isUpdated}
    Push $0
    Push $1
    Push $2
    StrCpy $2 $OUTDIR
    InitPluginsDir
    SetOutPath "$PLUGINSDIR"
    File /oname=dsh-owned-directory.mjs "${PROJECT_DIR}\lib\types\owned-directory.js"
    ; Node stays outside the removed runtime tree so a failed uninstall can retry.
    nsExec::ExecToStack '"$INSTDIR\resources\runtime\node\node.exe" --input-type=module -e "import{removeOwnedDirectory}from$\'./dsh-owned-directory.mjs$\';removeOwnedDirectory(process.argv[1]);" "$INSTDIR\resources\dsh"'
    Pop $0
    Pop $1
    SetOutPath $2
    ${If} $0 != 0
      DetailPrint "Desktop runtime cleanup failed: $1"
      SetErrorLevel 1
      Quit
    ${EndIf}
    Pop $2
    Pop $1
    Pop $0
  ${EndIf}
!macroend
