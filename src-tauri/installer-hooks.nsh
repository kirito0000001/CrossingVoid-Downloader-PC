!macro NSIS_HOOK_PREINSTALL
  ${If} $UpdateMode = 1
    StrCpy $R8 0
    wait_for_launcher_exit:
      !if "${INSTALLMODE}" == "currentUser"
        nsis_tauri_utils::FindProcessCurrentUser "${MAINBINARYNAME}.exe"
      !else
        nsis_tauri_utils::FindProcess "${MAINBINARYNAME}.exe"
      !endif
      Pop $R9
      ${If} $R9 = 0
      ${AndIf} $R8 < 20
        Sleep 250
        IntOp $R8 $R8 + 1
        Goto wait_for_launcher_exit
      ${EndIf}
  ${EndIf}
!macroend
