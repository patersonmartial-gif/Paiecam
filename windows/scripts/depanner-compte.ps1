# Raccourci « Dépanner un compte » : mot de passe oublié ou téléphone (2FA) perdu.
. "$PSScriptRoot\commun.ps1"
Assert-Admin $PSCommandPath
$email = Read-Host "Adresse e-mail du compte"
Write-Host "1. Mot de passe oublié (un mot de passe provisoire sera affiché)"
Write-Host "2. Téléphone perdu (la double authentification sera retirée, à réactiver)"
$choix = Read-Host "Votre choix (1 ou 2)"
try {
  if ($choix -eq "1") { Invoke-PaieCamAdmin reset-password --dossier $DataDir --email $email }
  elseif ($choix -eq "2") { Invoke-PaieCamAdmin reset-2fa --dossier $DataDir --email $email }
} catch { Write-Host $_ -ForegroundColor Red }
Pause-Fin
