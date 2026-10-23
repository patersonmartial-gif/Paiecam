#!/usr/bin/env bash
# Restauration d'une sauvegarde produite par backup.sh, dans une base VIDE.
#
#   restore.sh <dossier de sauvegarde>
#   RESTORE_ADMIN_DATABASE_URL  administrateur PostgreSQL sur la base cible (restaure propriétaires,
#                               droits et politiques RLS ; les rôles doivent exister : init.sql)
#   AGE_IDENTITY                fichier de clé privée age (conservé hors du serveur de production)
#   RESTORE_DOCUMENTS_DIR       facultatif : dossier vide où extraire les documents
#
# Refuse une sauvegarde altérée (empreintes), une base cible non vide, et s'arrête à la première
# erreur en annulant tout (une seule transaction).
set -euo pipefail
umask 077

src="${1:?usage : restore.sh <dossier de sauvegarde>}"
: "${RESTORE_ADMIN_DATABASE_URL:?RESTORE_ADMIN_DATABASE_URL est requise}"
: "${AGE_IDENTITY:?AGE_IDENTITY (clé privée age) est requise}"

(cd "$src" && sha256sum --check --quiet SHA256SUMS) || { echo "empreintes invalides : sauvegarde altérée" >&2; exit 1; }

tables=$(psql "$RESTORE_ADMIN_DATABASE_URL" -Atqc "select count(*) from pg_tables where schemaname not in ('pg_catalog','information_schema')")
[ "$tables" = "0" ] || { echo "refus : la base cible n'est pas vide ($tables tables)" >&2; exit 1; }

# Les schémas créés par défaut (public) existent déjà dans une base neuve : --clean --if-exists
# les remplace par ceux de la sauvegarde, sans toucher à rien d'autre (la base est vide).
age --decrypt --identity="$AGE_IDENTITY" "$src/db.dump.age" \
  | pg_restore --dbname="$RESTORE_ADMIN_DATABASE_URL" --single-transaction --exit-on-error \
      --clean --if-exists

if [ -n "${RESTORE_DOCUMENTS_DIR:-}" ] && [ -f "$src/documents.tar.age" ]; then
  mkdir -p "$RESTORE_DOCUMENTS_DIR"
  [ -z "$(ls -A "$RESTORE_DOCUMENTS_DIR")" ] || { echo "refus : $RESTORE_DOCUMENTS_DIR n'est pas vide" >&2; exit 1; }
  age --decrypt --identity="$AGE_IDENTITY" "$src/documents.tar.age" \
    | tar --extract --directory="$RESTORE_DOCUMENTS_DIR" --no-same-owner
fi
echo "restauration terminée depuis $src"
