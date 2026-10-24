/**
 * Processus des tâches de fond (PDF des bulletins) : pnpm --filter @paiecam/web worker
 * Il partage le code métier de l'application mais pas son serveur web.
 */
import { createDb } from "@paiecam/db";
import { parseKeyring } from "@paiecam/security";
import { parseEnv } from "./env-schema";
import { generatePeriodDocuments } from "./server/features/documents";
import { runDeadlineReminders, todayInDouala } from "./server/features/reminders";
import {
  BACKUP_QUEUE,
  PDF_QUEUE,
  REMINDER_QUEUE,
  startBoss,
  type PdfJob,
} from "./server/jobs/boss";
import { backupIsDue, localBackupConfigured, runLocalBackup } from "./server/jobs/local-backup";
import { createMailer, smtpTransportFromUrl } from "./server/mail";
import { log } from "./server/log";
import { storageFromEnv } from "./storage-from-env";

try {
  process.loadEnvFile("../../.env");
} catch {
  // variables fournies par l'environnement
}
const env = parseEnv(process.env);
const db = createDb(env.DATABASE_URL);
const keyring = parseKeyring(env.FIELD_ENCRYPTION_KEYS);
const storage = storageFromEnv(env, keyring);
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
const mailer = createMailer(env.NODE_ENV, {
  local: env.DEPLOYMENT === "local",
  outboxDir: env.MAIL_OUTBOX_DIR,
  smtp:
    env.SMTP_URL && env.MAIL_FROM
      ? { transport: await smtpTransportFromUrl(env.SMTP_URL), from: env.MAIL_FROM }
      : undefined,
});
await boss.schedule(REMINDER_QUEUE, "0 7 * * *", {}, { tz: "Africa/Douala" });
await boss.work(REMINDER_QUEUE, async () => {
  const result = await runDeadlineReminders(db, {
    mailer,
    baseURL: env.APP_URL,
    today: todayInDouala(),
  });
  log("info", "rappels d'échéance", result);
});

if (localBackupConfigured(env)) {
  // Chaque jour à 12 h 30 (heure de Douala : le PC est allumé), et au démarrage si la dernière
  // sauvegarde a plus de 20 h.
  await boss.schedule(BACKUP_QUEUE, "30 12 * * *", {}, { tz: "Africa/Douala" });
  await boss.work(BACKUP_QUEUE, async () => {
    const b = await runLocalBackup(env);
    log("info", "sauvegarde locale", { file: b.name, sizeBytes: b.sizeBytes });
  });
  if (await backupIsDue(env)) await boss.send(BACKUP_QUEUE, {}, { singletonKey: "backup" });
}

log("info", "worker démarré", { queue: PDF_QUEUE });

const stop = async () => {
  await boss.stop({ graceful: true });
  await db.$client.end();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
