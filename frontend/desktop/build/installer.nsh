; QS-VC Windows installer additions (electron-builder NSIS include).
; IT can pre-set the organisation's server for every user:
;   QS-VC-Setup-<version>.exe /S /SERVERURL=https://vc.example.gov.in
; The address is written to %ProgramData%\QS-VC\workspace.json, which the app reads at start.
!include "FileFunc.nsh"

!macro customInstall
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/SERVERURL=" $R1
  ${IfNot} ${Errors}
    StrCpy $R2 $R1 8
    ${If} $R2 == "https://"
      SetShellVarContext all
      CreateDirectory "$APPDATA\QS-VC"
      FileOpen $R3 "$APPDATA\QS-VC\workspace.json" w
      FileWrite $R3 '{"workspaceUrl":"$R1"}$\r$\n'
      FileClose $R3
    ${Else}
      DetailPrint "Ignored /SERVERURL: it must start with https://"
    ${EndIf}
  ${EndIf}
!macroend
