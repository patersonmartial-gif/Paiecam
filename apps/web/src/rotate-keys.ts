/**
 * Rotation des clés de chiffrement — procédure : docs/securite/rotation-des-cles.md
 *   pnpm --filter @paiecam/web rotate-keys            (simulation : compte sans rien modifier)
 *   pnpm --filter @paiecam/web rotate-keys --apply    (rechiffre et signe à nouveau)
 */
import { createDb } from "@paiecam/db";
import { parseKeyring } from "@paiecam/security";
import { parseEnv } from "./env-schema";
import { rotateKeys } from "./server/features/key-rotation";
import { storageFromEnv } from "./storage-from-env";

try {
  process.loadEnvFile("../../.env");
} catch {
  // variables fournies par l'environnement
}
const env = parseEnv(process.env);
if (!env.ROTATION_DATABASE_URL) {
  console.error("ROTATION_DATABASE_URL (rôle paiecam_rotation) est requise");
  process.exit(1);
}
const keyring = parseKeyring(env.FIELD_ENCRYPTION_KEYS);
const db = createDb(env.ROTATION_DATABASE_URL);
const dryRun = !process.argv.includes("--apply");
try {
  const report = await rotateKeys(
    db,
    { keyring, storage: storageFromEnv(env, keyring) },
    { dryRun },
  );
  console.warn(JSON.stringify(report, null, 2));
  if (report.failures.length > 0) {
    console.error(
      `${report.failures.length} élément(s) à examiner : ne retirez pas l'ancienne clé.`,
    );
    process.exitCode = 2;
  } else if (dryRun) {
    console.warn("Simulation terminée. Relancez avec --apply pour appliquer.");
  } else {
    console.warn(
      `Rotation terminée : plus aucune donnée n'utilise une autre clé que ${report.keyId}.`,
    );
  }
} finally {
  await db.$client.end();
}
