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
echo "PaieCam démarre (journaux dans .data/journaux)."
