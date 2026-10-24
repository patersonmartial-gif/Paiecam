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

function Start-PaieCamApp {
  foreach ($s in "PaieCam-Base", "PaieCam-Web", "PaieCam-Worker") {
    if (Get-Service $s -ErrorAction SilentlyContinue) { Start-Service $s }
  }
}

function Wait-PaieCam([int]$Seconds = 90) {
  for ($i = 0; $i -lt $Seconds; $i++) {
    try {
      $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://localhost:3000/api/health"
      if ($r.StatusCode -eq 200) { return }
    } catch { Start-Sleep -Seconds 1 }
  }
  throw "PaieCam ne répond pas sur http://localhost:3000"
}

function Pause-Fin { Write-Host ""; Read-Host "Appuyez sur Entrée pour fermer" | Out-Null }
