import { createBackup, listBackups } from "@paiecam/local/backup";
import type { Env } from "@/env-schema";
import { APP_VERSION } from "@/version";

/** Une sauvegarde de moins de 20 h suffit : le PC est souvent éteint à l'heure prévue. */
const FRESH_MS = 20 * 3600 * 1000;

export function localBackupConfigured(env: Env): boolean {
  return Boolean(env.BACKUP_DIR && env.BACKUP_RECIPIENT && env.BACKUP_DATABASE_URL);
}

export async function lastBackupAge(env: Env, now = Date.now()): Promise<number | null> {
  const [last] = await listBackups(env.BACKUP_DIR ?? "");
  return last ? now - last.createdAt.getTime() : null;
}

export async function backupIsDue(env: Env, now = Date.now()): Promise<boolean> {
  const age = await lastBackupAge(env, now);
  return age === null || age > FRESH_MS;
}

export function runLocalBackup(env: Env) {
  return createBackup({
    pgBinDir: env.PG_BIN_DIR,
    databaseUrl: env.BACKUP_DATABASE_URL ?? "",
    documentsDir: env.DOCUMENTS_DIR,
    backupDir: env.BACKUP_DIR ?? "",
    recipient: env.BACKUP_RECIPIENT ?? "",
    // Restaurés avec les données : sans eux, champs chiffrés, documents et 2FA seraient illisibles.
    secrets: {
      FIELD_ENCRYPTION_KEYS: env.FIELD_ENCRYPTION_KEYS,
      BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
    },
    appVersion: APP_VERSION,
  });
}
