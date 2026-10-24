/**
 * Processus des tâches de fond (PDF des bulletins) : pnpm --filter @paiecam/web worker
 * Il partage le code métier de l'application mais pas son serveur web.
 */
import { createDb } from "@paiecam/db";
import { parseKeyring } from "@paiecam/security";
import { parseEnv } from "./env-schema";
import { generatePeriodDocuments } from "./server/features/documents";
import { runDeadlineReminders, todayInDouala } from "./server/features/reminders";
import { PDF_QUEUE, REMINDER_QUEUE, startBoss, type PdfJob } from "./server/jobs/boss";
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

log("info", "worker démarré", { queue: PDF_QUEUE });

const stop = async () => {
  await boss.stop({ graceful: true });
  await db.$client.end();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
