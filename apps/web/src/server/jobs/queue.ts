import "server-only";
import type { PgBoss } from "pg-boss";
import { env } from "@/env";
import { PDF_QUEUE, startBoss, type PdfJob } from "./boss";

let boss: Promise<PgBoss> | null = null;

/** Met en file la génération des PDF d'un mois validé (à appeler APRÈS la validation). */
export async function enqueuePayslipPdfs(periodId: string, tenantId: string): Promise<void> {
  boss ??= startBoss(env.DATABASE_URL);
  const data: PdfJob = { tenantId, periodId };
  await (
    await boss
  ).send(PDF_QUEUE, data, { singletonKey: periodId, retryLimit: 5, retryBackoff: true });
}
