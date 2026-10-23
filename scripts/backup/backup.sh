#!/usr/bin/env bash
# Sauvegarde chiffrée de PaieCam : base PostgreSQL et, avec le stockage disque, les documents.
#
#   BACKUP_DATABASE_URL     rôle paiecam_backup (lecture seule, exempté du RLS)
#   BACKUP_AGE_RECIPIENTS   fichier des clés publiques age (une par ligne) : le serveur ne détient
#                           AUCUNE clé de déchiffrement, une sauvegarde volée reste illisible
#   BACKUP_DIR              dossier de destination (ensuite copié hors site, voir docs/exploitation)
#   DOCUMENTS_DIR           facultatif : documents du stockage disque (en S3 : versionnage du bucket)
#
# Produit BACKUP_DIR/paiecam-<horodatage UTC>/ : db.dump.age, [documents.tar.age], SHA256SUMS.
# Les documents sont déjà chiffrés par l'application : sans FIELD_ENCRYPTION_KEYS (sauvegardées
# à part, sous séquestre), ils sont inexploitables. Ne jamais stocker ces clés avec la sauvegarde.
set -euo pipefail
umask 077

: "${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL est requise}"
: "${BACKUP_AGE_RECIPIENTS:?BACKUP_AGE_RECIPIENTS (fichier de clés publiques age) est requise}"
: "${BACKUP_DIR:?BACKUP_DIR est requise}"
[ -s "$BACKUP_AGE_RECIPIENTS" ] || { echo "fichier de destinataires age vide ou absent" >&2; exit 1; }

stamp=$(date -u +%Y%m%dT%H%M%SZ)
out="$BACKUP_DIR/paiecam-$stamp"
mkdir -p "$out"
trap 'echo "échec : sauvegarde incomplète supprimée" >&2; rm -rf "$out"' ERR

# Format « custom » (compressé, restauration sélective possible). Les tâches pg-boss sont
# transitoires : leur structure est sauvegardée, pas leur contenu (pas de rappels rejoués).
pg_dump --dbname="$BACKUP_DATABASE_URL" --format=custom --compress=6 \
  --exclude-table-data='pgboss.*' \
  | age --encrypt --recipients-file="$BACKUP_AGE_RECIPIENTS" --output="$out/db.dump.age"

if [ -n "${DOCUMENTS_DIR:-}" ] && [ -d "$DOCUMENTS_DIR" ]; then
  tar --create --directory="$DOCUMENTS_DIR" . \
    | age --encrypt --recipients-file="$BACKUP_AGE_RECIPIENTS" --output="$out/documents.tar.age"
fi

(cd "$out" && sha256sum -- *.age > SHA256SUMS)
trap - ERR
echo "$out"
