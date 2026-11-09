; Shorteo - etapes ajoutees a l'installateur Windows (NSIS)

!macro NSIS_HOOK_PREINSTALL
  ; Migration : l'application s'appelait "Yateo Search" (v0.1.0).
  ; Son desinstalleur est lance en mode silencieux (il ferme l'ancienne app si elle tourne),
  ; sans toucher aux reglages, a l'index ni aux cles, qui sont repris par Shorteo.
  IfFileExists "$LOCALAPPDATA\Yateo Search\uninstall.exe" 0 shorteo_no_legacy
    DetailPrint "Suppression de l'ancienne version Yateo Search..."
    ExecWait '"$LOCALAPPDATA\Yateo Search\uninstall.exe" /S _?=$LOCALAPPDATA\Yateo Search'
    Delete "$LOCALAPPDATA\Yateo Search\uninstall.exe"
    RMDir "$LOCALAPPDATA\Yateo Search"
  shorteo_no_legacy:
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Yateo Search"
  ; Ancien lancement automatique au demarrage de Windows
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Yateo Search"
!macroend
