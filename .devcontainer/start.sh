#!/usr/bin/env bash
# À chaque démarrage du Codespace : application web (port 3000) et tâches de fond.
set -euo pipefail
cd "$(dirname "$0")/.."
bash .devcontainer/app-url.sh
mkdir -p .data/journaux
( cd apps/web && nohup pnpm exec next dev -p 3000 > ../../.data/journaux/web.log 2>&1 & )
( cd apps/web && nohup pnpm worker > ../../.data/journaux/worker.log 2>&1 & )
echo "PaieCam démarre (journaux dans .data/journaux)."
