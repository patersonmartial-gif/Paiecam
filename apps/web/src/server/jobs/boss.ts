import { PgBoss } from "pg-boss";

/** File des PDF de bulletins : une tâche = un mois validé d'une entreprise. */
export const PDF_QUEUE = "payslip-pdfs";

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
  if (!(await boss.getQueue(PDF_QUEUE))) await boss.createQueue(PDF_QUEUE);
  return boss;
}
