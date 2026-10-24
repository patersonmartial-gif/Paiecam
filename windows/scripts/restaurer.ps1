# Raccourci « Restaurer une sauvegarde » : remplace TOUTES les données par celles de la sauvegarde.
. "$PSScriptRoot\commun.ps1"
Assert-Admin $PSCommandPath
Add-Type -AssemblyName System.Windows.Forms
$dlg = New-Object System.Windows.Forms.OpenFileDialog
$dlg.Title = "Choisir la sauvegarde PaieCam à restaurer"
$dlg.Filter = "Sauvegardes PaieCam (*.sauvegarde)|*.sauvegarde"
$dlg.InitialDirectory = Join-Path $DataDir "sauvegardes"
if ($dlg.ShowDialog() -ne "OK") { exit }
Write-Host "ATTENTION : les données actuelles seront remplacées par celles du $((Get-Item $dlg.FileName).LastWriteTime)."
if ((Read-Host "Tapez RESTAURER pour confirmer") -ne "RESTAURER") { exit }
try {
  Stop-PaieCamApp
  # La clé du kit de récupération est demandée par paiecam-admin (jamais en argument).
  Invoke-PaieCamAdmin restore --dossier $DataDir --fichier $dlg.FileName
} catch { Write-Host $_ -ForegroundColor Red }
finally { Start-PaieCamApp }
Pause-Fin
