/**
 * Processus des tâches de fond (PDF des bulletins) : pnpm --filter @paiecam/web worker
 * Il partage le code métier de l'application mais pas son serveur web.
 */
import { createDb } from "@paiecam/db";
import { createFsStorage } from "@paiecam/documents";
import { parseKeyring } from "@paiecam/security";
import { parseEnv } from "./env-schema";
import { generatePeriodDocuments } from "./server/features/documents";
import { PDF_QUEUE, startBoss, type PdfJob } from "./server/jobs/boss";
import { log } from "./server/log";

try {
  process.loadEnvFile("../../.env");
} catch {
  // variables fournies par l'environnement
}
const env = parseEnv(process.env);
const db = createDb(env.DATABASE_URL);
const keyring = parseKeyring(env.FIELD_ENCRYPTION_KEYS);
const storage = createFsStorage(env.DOCUMENTS_DIR, keyring);
const boss = await startBoss(env.DATABASE_URL);

await boss.work<PdfJob>(PDF_QUEUE, async (jobs) => {
  for (const job of jobs) {
    const result = await generatePeriodDocuments(
      db,
      { keyring, storage, baseURL: env.APP_URL },
      job.data,
    );
    log("info", "PDF générés", { periodId: job.data.periodId, ...result });
  }
});
log("info", "worker démarré", { queue: PDF_QUEUE });

const stop = async () => {
  await boss.stop({ graceful: true });
  await db.$client.end();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
