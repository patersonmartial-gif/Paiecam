# Fonctions communes aux scripts PaieCam (chargées par « . $PSScriptRoot\commun.ps1 »).
$ErrorActionPreference = "Stop"
$AppDir = Split-Path -Parent $PSScriptRoot
$DataDir = Join-Path $env:ProgramData "PaieCam"
$Node = Join-Path $AppDir "node\node.exe"
$Admin = Join-Path $AppDir "outils\admin.mjs"
$PgBin = Join-Path $AppDir "pgsql\bin"

# Relance le script en administrateur si besoin (les données ne sont lisibles que par eux).
function Assert-Admin([string]$Script) {
  $id = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  if (-not $id.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Start-Process powershell.exe -Verb RunAs -ArgumentList @(
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$Script`""
    )
    exit
  }
}

function Invoke-PaieCamAdmin {
  & $Node $Admin @args
  if ($LASTEXITCODE -ne 0) { throw "paiecam-admin $($args[0]) a échoué (code $LASTEXITCODE)" }
}

function Stop-PaieCamApp {
  foreach ($s in "PaieCam-Web", "PaieCam-Worker") {
    if (Get-Service $s -ErrorAction SilentlyContinue) { Stop-Service $s -Force -ErrorAction SilentlyContinue }
  }
}

# Journal des étapes : fichier séparé, lisible pendant que le script tourne encore.
$EtapesLog = Join-Path $DataDir "journaux\etapes.log"
function Write-Etape([string]$Message) {
  $line = "$(Get-Date -Format s) $Message"
  Write-Host $line
  try { Add-Content -Path $EtapesLog -Value $line -Encoding UTF8 } catch { }
}

# Démarre un service sans jamais attendre indéfiniment (Start-Service peut rester bloqué).
function Start-ServiceWithTimeout([string]$Name, [int]$Seconds = 90) {
  $svc = Get-Service $Name -ErrorAction SilentlyContinue
  if (-not $svc) { return }
  if ($svc.Status -ne "Running") { sc.exe start $Name | Out-Null }
  try {
    $svc.WaitForStatus("Running", [TimeSpan]::FromSeconds($Seconds))
  } catch {
    $state = (Get-Service $Name).Status
    throw "le service $Name n'a pas démarré en $Seconds s (état : $state)"
  }
  Write-Etape "service $Name démarré"
}

function Start-PaieCamApp {
  foreach ($s in "PaieCam-Base", "PaieCam-Web", "PaieCam-Worker") { Start-ServiceWithTimeout $s }
}

# Contrôle direct, sans le proxy du système (Invoke-WebRequest de PowerShell 5.1 l'utiliserait).
function Wait-PaieCam([int]$Seconds = 90) {
  $url = "http://127.0.0.1:3000/api/health"
  for ($i = 0; $i -lt $Seconds; $i++) {
    try {
      $req = [System.Net.HttpWebRequest]::Create($url)
      $req.Proxy = $null
      $req.Timeout = 3000
      $res = $req.GetResponse()
      $ok = [int]$res.StatusCode -eq 200
      $res.Close()
      if ($ok) { return }
    } catch { Start-Sleep -Seconds 1 }
  }
  throw "PaieCam ne répond pas sur $url"
}

function Pause-Fin { Write-Host ""; Read-Host "Appuyez sur Entrée pour fermer" | Out-Null }
