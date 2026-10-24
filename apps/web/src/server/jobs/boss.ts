import { PgBoss } from "pg-boss";

/** File des PDF de bulletins : une tâche = un mois validé d'une entreprise. */
export const PDF_QUEUE = "payslip-pdfs";

/** Rappels d'échéance : tâche planifiée chaque jour à 7 h, heure de Douala. */
export const REMINDER_QUEUE = "deadline-reminders";

/** Installation locale : sauvegarde chiffrée (quotidienne, ou demandée depuis l'application). */
export const BACKUP_QUEUE = "local-backup";

export interface PdfJob {
  tenantId: string;
  periodId: string;
}

export async function startBoss(connectionString: string): Promise<PgBoss> {
  // Le schéma est créé par la migration 0014 : le rôle applicatif n'a pas le droit CREATE sur la base.
  const boss = new PgBoss({ connectionString, schema: "pgboss", createSchema: false });
  boss.on("error", (e) =>
    console.error(JSON.stringify({ level: "error", message: "pg-boss", error: e.message })),
  );
  await boss.start();
  for (const q of [PDF_QUEUE, REMINDER_QUEUE, BACKUP_QUEUE]) {
    if (!(await boss.getQueue(q))) await boss.createQueue(q);
  }
  return boss;
}
