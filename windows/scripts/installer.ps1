# Appelé par l'installateur (administrateur) : première installation ou mise à jour.
. "$PSScriptRoot\commun.ps1"
$Migrations = Join-Path $AppDir "outils\migrations"
$Rules = Join-Path $AppDir "outils\referentiel\cm-2026.json"
$Config = Join-Path $DataDir "config\paiecam.env"

New-Item -ItemType Directory -Force -Path $DataDir, (Join-Path $DataDir "journaux") | Out-Null
Start-Transcript -Path (Join-Path $DataDir "journaux\installation.log") -Append | Out-Null
trap { Write-Etape "ÉCHEC : $_"; Stop-Transcript | Out-Null; exit 1 }
Write-Etape "préparation de PaieCam (dossier $DataDir)"
# Données : Administrateurs et SYSTEM (contrôle total), Service réseau (modification), personne d'autre.
icacls $DataDir /inheritance:r /grant:r "*S-1-5-32-544:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" "*S-1-5-20:(OI)(CI)M" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "droits du dossier $DataDir" }

Write-Etape "droits du dossier des données posés"
if (Test-Path $Config) {
  Write-Etape "mise à jour d'une installation existante"
  # Mise à jour : la base tourne, sauvegarde complète puis migrations (paiecam-admin update).
  Start-ServiceWithTimeout PaieCam-Base
  Invoke-PaieCamAdmin update --dossier $DataDir --migrations $Migrations --referentiel $Rules
} else {
  Write-Etape "première installation : base de données, rôles, migrations, référentiel"
  # initdb se relance avec des droits réduits (sans le groupe Administrateurs) : le compte qui
  # installe reçoit un accès explicite le temps de créer la base, retiré juste après.
  $Me = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  icacls $DataDir /grant "*${Me}:(OI)(CI)F" | Out-Null
  try {
    Invoke-PaieCamAdmin install --dossier $DataDir --pg-bin $PgBin --migrations $Migrations --referentiel $Rules
  } finally {
    icacls $DataDir /remove:g "*$Me" /T /C | Out-Null
  }
  Write-Etape "base créée ; enregistrement du service PaieCam-Base"
  $Base = Join-Path $DataDir "donnees\base"
  icacls $Base /grant "*S-1-5-20:(OI)(CI)F" | Out-Null
  & (Join-Path $PgBin "pg_ctl.exe") register -N "PaieCam-Base" -D $Base -S auto -U "NT AUTHORITY\NetworkService" -w
  if ($LASTEXITCODE -ne 0) { throw "enregistrement du service PaieCam-Base" }
}

foreach ($s in "PaieCam-Web", "PaieCam-Worker") {
  Write-Etape "service $s"
  if (-not (Get-Service $s -ErrorAction SilentlyContinue)) {
    & (Join-Path $AppDir "services\$s.exe") install
    if ($LASTEXITCODE -ne 0) { throw "installation du service $s" }
  }
}
Start-PaieCamApp
Write-Etape "attente de l'application"
Wait-PaieCam
Write-Etape "PaieCam répond : installation terminée"
Stop-Transcript | Out-Null
exit 0
