#!/usr/bin/env bash
# Adresse publique du Codespace (https://<nom>-3000.<domaine>) inscrite dans .env : la connexion
# et les formulaires vérifient que les requêtes viennent bien de cette adresse.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -n "${CODESPACE_NAME:-}" ] && [ -n "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ]; then
  url="https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
else
  url="http://localhost:3000"
fi
if grep -q '^APP_URL=' .env; then
  sed -i "s|^APP_URL=.*|APP_URL=${url}|" .env
else
  echo "APP_URL=${url}" >> .env
fi
echo "Adresse de PaieCam : ${url}"
