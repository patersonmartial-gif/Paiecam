#!/usr/bin/env bash
# Première création du Codespace : dépendances, configuration, base de données.
set -euo pipefail
cd "$(dirname "$0")/.."

corepack enable >/dev/null 2>&1 || sudo corepack enable
pnpm install --frozen-lockfile

# Configuration de démonstration : secrets tirés au hasard, propres à ce Codespace.
if [ ! -f .env ]; then
  cp .env.example .env
  sed -i "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=$(openssl rand -base64 32)|" .env
  sed -i "s|^FIELD_ENCRYPTION_KEYS=.*|FIELD_ENCRYPTION_KEYS=v1:$(openssl rand -base64 32)|" .env
fi
bash .devcontainer/app-url.sh

pnpm db:migrate
pnpm --filter @paiecam/db rules:load ../paie-engine/rules/cm-2026.draft.json
echo "PaieCam est prêt. Données FICTIVES uniquement."
