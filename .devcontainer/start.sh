#!/usr/bin/env bash
# À chaque démarrage du Codespace : application web (port 3000) et tâches de fond.
set -euo pipefail
cd "$(dirname "$0")/.."
bash .devcontainer/app-url.sh
mkdir -p .data/journaux
# setsid : les programmes quittent le groupe du script, que Codespaces arrête quand il se termine.
cd apps/web
setsid -f pnpm exec next dev -p 3000 > ../../.data/journaux/web.log 2>&1 < /dev/null
setsid -f pnpm worker > ../../.data/journaux/worker.log 2>&1 < /dev/null
cd ../..
# Mode développement : chaque page se compile à sa première visite (plus d'une minute pour la
# première), au-delà du délai du relais de GitHub (erreur 502). On les prépare d'avance.
setsid -f bash -c 'for p in /connexion /inscription /entreprise/nouvelle /tableau-de-bord; do
  curl -s -o /dev/null --max-time 600 "http://localhost:3000$p"; done' > /dev/null 2>&1 < /dev/null
echo "PaieCam démarre (journaux dans .data/journaux)."
