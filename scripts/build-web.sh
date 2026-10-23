#!/usr/bin/env sh
# Build de production de l'application web, sans aucun secret.
# Next.js importe les modules serveur pendant le build (collecte des pages) : la validation de l'env
# exige alors des valeurs. On fournit des valeurs factices, limitées à cette commande ; les vraies
# variables sont lues au démarrage du serveur (process.env n'est pas figé dans le code serveur).
# Seule APP_URL est figée au build (origines autorisées des Server Actions) : la passer en argument.
set -eu
: "${APP_URL:?APP_URL (URL publique, ex. https://app.paiecam.example) est requise pour le build}"
NODE_ENV=production PWNED_PASSWORDS_CHECK=on MAIL_OUTBOX_DIR= PAYROLL_ALLOW_DRAFT_RULES=off \
DATABASE_URL=postgres://build:build@127.0.0.1:1/build \
BETTER_AUTH_SECRET=build-placeholder-not-a-secret-000000000000 \
FIELD_ENCRYPTION_KEYS=v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \
TRUSTED_PROXY_HEADER=x-forwarded-for \
SMTP_URL=smtp://build.invalid:25 \
MAIL_FROM=build@build.invalid SECURITY_CONTACT=mailto:build@build.invalid \
STORAGE_DRIVER=s3 S3_ENDPOINT=https://build.invalid S3_REGION=build S3_BUCKET=build \
S3_ACCESS_KEY_ID=build S3_SECRET_ACCESS_KEY=build \
  pnpm --filter @paiecam/web build
