# Raccourci « Sauvegarder maintenant ».
. "$PSScriptRoot\commun.ps1"
Assert-Admin $PSCommandPath
try {
  Invoke-PaieCamAdmin backup --dossier $DataDir
  Write-Host "Pensez à copier ce fichier sur une clé USB ou un disque externe." -ForegroundColor Yellow
  Start-Process explorer.exe (Join-Path $DataDir "sauvegardes")
} catch { Write-Host $_ -ForegroundColor Red }
Pause-Fin
