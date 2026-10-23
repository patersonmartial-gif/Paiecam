import { and, eq, inArray, schema, sql, withTenant, type Db } from "@paiecam/db";
import type { Mailer } from "../mail";
import { log } from "../log";
import { SYSTEM_USER } from "./documents";

export type ReminderStage = "j-7" | "j-2" | "j0" | "late";

const DAY = 86_400_000;
const days = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

/**
 * Étape de rappel pour une échéance. Les fenêtres (3 à 7 jours, 1 à 2 jours) rattrapent une
 * journée manquée : chaque étape part une seule fois, même si la tâche n'a pas tourné le jour exact.
 */
export function reminderStage(dueDate: string, today: string): ReminderStage | null {
  const left = days(today, dueDate);
  if (left < 0) return "late";
  if (left === 0) return "j0";
  if (left <= 2) return "j-2";
  if (left <= 7) return "j-7";
  return null;
}

/** Date du jour au Cameroun (Africa/Douala), au format ISO. */
export function todayInDouala(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Douala",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

const KIND_LABEL = {
  cnps: "Cotisations CNPS",
  dgi: "Retenues et taxes DGI",
  dipe: "DIPE",
} as const;
const SUBJECT: Record<ReminderStage, string> = {
  "j-7": "dans 7 jours ou moins",
  "j-2": "dans 2 jours ou moins",
  j0: "aujourd'hui",
  late: "EN RETARD",
};
const fr = (iso: string) => iso.split("-").reverse().join("/");

/**
 * Tâche quotidienne : rappels d'échéance par e-mail aux propriétaires et gestionnaires paie.
 * Chaque déclaration est relue sous RLS dans son entreprise ; l'envoi est enregistré dans la même
 * transaction (contrainte d'unicité : jamais deux fois la même étape).
 */
export async function runDeadlineReminders(
  db: Db,
  deps: { mailer: Mailer; baseURL: string; today: string },
): Promise<{ sent: number; recipients: number }> {
  const horizon = new Date(Date.parse(`${deps.today}T00:00:00Z`) + 7 * DAY)
    .toISOString()
    .slice(0, 10);
  const due = await db.execute<{ declaration_id: string; tenant_id: string }>(sql`
    select declaration_id, tenant_id from declaration_deadlines
    where status = 'generated' and due_date <= ${horizon}::date
    order by due_date`);

  let sent = 0;
  let recipients = 0;
  for (const row of due) {
    try {
      const r = await withTenant(
        db,
        { tenantId: row.tenant_id, userId: SYSTEM_USER },
        async (tx) => {
          const [d] = await tx
            .select({
              id: schema.declarations.id,
              kind: schema.declarations.kind,
              dueDate: schema.declarations.dueDate,
              status: schema.declarations.status,
              amountDue: schema.declarations.amountDue,
              periodId: schema.declarations.periodId,
              year: schema.payPeriods.year,
              month: schema.payPeriods.month,
            })
            .from(schema.declarations)
            .innerJoin(schema.payPeriods, eq(schema.payPeriods.id, schema.declarations.periodId))
            .where(eq(schema.declarations.id, row.declaration_id));
          if (!d || d.status !== "generated") return 0;
          const stage = reminderStage(d.dueDate, deps.today);
          if (!stage) return 0;
          const [tenant] = await tx.select({ name: schema.tenants.legalName }).from(schema.tenants);
          const to = await tx
            .select({ email: schema.users.email })
            .from(schema.memberships)
            .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
            .where(
              and(
                eq(schema.memberships.tenantId, row.tenant_id),
                inArray(schema.memberships.role, ["owner", "payroll_manager"]),
              ),
            );
          if (to.length === 0) return 0;
          const claimed = await tx
            .insert(schema.reminderDeliveries)
            .values({
              tenantId: row.tenant_id,
              declarationId: d.id,
              stage,
              channel: "email",
              recipients: to.length,
            })
            .onConflictDoNothing()
            .returning({ id: schema.reminderDeliveries.id });
          if (claimed.length === 0) return 0;
          const period = `${String(d.month).padStart(2, "0")}/${d.year}`;
          const amount =
            d.kind === "dipe" ? "" : `Montant dû : ${d.amountDue.toLocaleString("fr-FR")} FCFA.\n`;
          for (const { email } of to) {
            await deps.mailer.send({
              to: email,
              subject: `[PaieCam] ${KIND_LABEL[d.kind]} de ${period} : échéance ${SUBJECT[stage]} (${fr(d.dueDate)})`,
              text: `${tenant?.name ?? ""}\n${KIND_LABEL[d.kind]} de la paie de ${period}, à déposer au plus tard le ${fr(d.dueDate)}.\n${amount}Ouvrir le mois : ${deps.baseURL}/paie/${d.periodId}`,
            });
          }
          return to.length;
        },
      );
      if (r > 0) {
        sent++;
        recipients += r;
      }
    } catch (e) {
      // Une entreprise en erreur n'empêche pas les rappels des autres ; l'étape sera retentée demain.
      log("error", "échec d'un rappel d'échéance", { declarationId: row.declaration_id, error: e });
    }
  }
  return { sent, recipients };
}
