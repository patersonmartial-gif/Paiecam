# Appelé par le désinstallateur : retire les services. LES DONNÉES SONT CONSERVÉES
# (%ProgramData%\PaieCam) : la paie doit être conservée des années ; à supprimer à la main.
. "$PSScriptRoot\commun.ps1"
Stop-PaieCamApp
foreach ($s in "PaieCam-Web", "PaieCam-Worker") {
  $exe = Join-Path $AppDir "services\$s.exe"
  if ((Get-Service $s -ErrorAction SilentlyContinue) -and (Test-Path $exe)) { & $exe uninstall }
}
if (Get-Service "PaieCam-Base" -ErrorAction SilentlyContinue) {
  Stop-Service "PaieCam-Base" -Force -ErrorAction SilentlyContinue
  & (Join-Path $PgBin "pg_ctl.exe") unregister -N "PaieCam-Base"
}
