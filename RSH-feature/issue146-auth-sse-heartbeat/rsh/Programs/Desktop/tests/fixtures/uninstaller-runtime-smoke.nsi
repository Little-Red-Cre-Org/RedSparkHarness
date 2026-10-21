; TARGET_DIR is a private installation fixture with a bundled Node executable.
Unicode true
RequestExecutionLevel user
SilentInstall silent
Name "Desktop uninstaller runtime smoke"
OutFile "${OUTPUT_FILE}"
!define isUpdated '$R9 == "1"'
!include "..\..\scripts\installer.nsh"

Section
  StrCpy $INSTDIR "${TARGET_DIR}"
  StrCpy $R9 "${UPDATED}"
  SetOutPath "$TEMP"
  !insertmacro customUnInstall
  SetErrorLevel 0
SectionEnd
