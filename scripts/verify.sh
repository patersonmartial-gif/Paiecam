#!/usr/bin/env bash
# Vérification complète avant commit : s'arrête à la première erreur.
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm lint
pnpm typecheck
pnpm test
if [[ "${E2E:-1}" == "1" ]]; then
  pnpm --filter @paiecam/web test:e2e
fi
echo "Tout est vert."
