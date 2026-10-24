/**
 * Prêts et avances sur salaire : retenue mensuelle automatique sur le net, solde suivi par les
 * remboursements des mois validés. La base garantit l'essentiel (jamais plus que le montant
 * prêté, remboursement seulement sur une paie validée, montant immuable : migration 0022).
 */
import { z } from "zod";
import { and, asc, eq, inArray, schema, sql, type Db, type Tx } from "@paiecam/db";
import type { PayItemInput } from "@paiecam/paie-engine";
import { createTenantAction, RuleError } from "../authz/action";

const { employeeLoans: loans, loanRepayments: repayments } = schema;

/** Code de la ligne de bulletin d'une échéance : relie le bulletin au prêt lors de la validation. */
export const loanItemCode = (loanId: string) => `loan:${loanId}`;
const LOAN_ITEM = /^loan:([0-9a-f-]{36})$/;
export const loanSkipKey = (loanId: string) => `loan_skip:${loanId}`;

const monthIndex = (year: number, month: number) => year * 12 + month;

async function repaidByLoan(tx: Tx, loanIds: string[]) {
  if (loanIds.length === 0) return new Map<string, { total: number; count: number }>();
  const rows = await tx
    .select({
      loanId: repayments.loanId,
      total: sql<number>`sum(${repayments.amount})::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(repayments)
    .where(inArray(repayments.loanId, loanIds))
    .groupBy(repayments.loanId);
  return new Map(rows.map((r) => [r.loanId, { total: r.total, count: r.count }]));
}

/**
 * Échéances du mois pour les salariés donnés : la mensualité, ou le reste dû s'il est plus petit.
 * Une échéance suspendue (variable « loan_skip ») n'est pas retenue ce mois-ci.
 */
export async function loanDeductionsForPeriod(
  tx: Tx,
  period: { year: number; month: number },
  employeeIds: string[],
  skipped: ReadonlySet<string>,
): Promise<Map<string, { items: PayItemInput[]; balanceAfter: number }>> {
  const out = new Map<string, { items: PayItemInput[]; balanceAfter: number }>();
  if (employeeIds.length === 0) return out;
  const active = (
    await tx
      .select()
      .from(loans)
      .where(and(eq(loans.status, "active"), inArray(loans.employeeId, employeeIds)))
      .orderBy(asc(loans.createdAt))
  ).filter((l) => monthIndex(l.startYear, l.startMonth) <= monthIndex(period.year, period.month));
  const repaid = await repaidByLoan(
    tx,
    active.map((l) => l.id),
  );
  for (const l of active) {
    const done = repaid.get(l.id) ?? { total: 0, count: 0 };
    const remaining = l.principal - done.total;
    if (remaining <= 0) continue;
    const entry = out.get(l.employeeId) ?? { items: [], balanceAfter: 0 };
    out.set(l.employeeId, entry);
    if (skipped.has(l.id)) {
      entry.balanceAfter += remaining;
      continue;
    }
    const amount = Math.min(l.installment, remaining);
    entry.balanceAfter += remaining - amount;
    const number = done.count + 1;
    const totalCount = done.count + Math.ceil(remaining / l.installment);
    entry.items.push({
      code: loanItemCode(l.id),
      label: `${l.label} — échéance ${number}/${totalCount}`,
      kind: "deduction",
      amount,
      subjectToCnps: false,
      taxable: false,
    });
  }
  return out;
}

/**
 * À la validation du mois (même transaction) : enregistre les échéances figurant sur les bulletins.
 * Un prêt annulé ou modifié depuis le calcul impose de recalculer le mois.
 */
export async function recordLoanRepayments(tx: Tx, tenantId: string, periodId: string) {
  const slips = await tx
    .select({ input: schema.payslips.input })
    .from(schema.payslips)
    .where(eq(schema.payslips.periodId, periodId));
  const due = new Map<string, number>();
  for (const s of slips) {
    for (const item of (s.input as { items?: PayItemInput[] }).items ?? []) {
      const id = LOAN_ITEM.exec(item.code)?.[1];
      if (id) due.set(id, (due.get(id) ?? 0) + item.amount);
    }
  }
  if (due.size === 0) return 0;
  const ids = [...due.keys()];
  const current = await tx.select().from(loans).where(inArray(loans.id, ids));
  const repaid = await repaidByLoan(tx, ids);
  for (const id of ids) {
    const l = current.find((x) => x.id === id);
    const remaining = (l?.principal ?? 0) - (repaid.get(id)?.total ?? 0);
    if (!l || l.status !== "active" || (due.get(id) ?? 0) > remaining)
      throw new RuleError("loans_changed");
  }
  await tx
    .insert(repayments)
    .values(ids.map((loanId) => ({ tenantId, loanId, periodId, amount: due.get(loanId) ?? 0 })));
  return ids.length;
}

/** Un prêt figurant sur un bulletin calculé mais non validé ne change pas : rouvrir le mois d'abord. */
async function assertNotOnCalculatedPayslip(tx: Tx, loanId: string) {
  const [hit] = await tx
    .select({ id: schema.payslips.id })
    .from(schema.payslips)
    .innerJoin(schema.payPeriods, eq(schema.payPeriods.id, schema.payslips.periodId))
    .where(
      and(
        eq(schema.payPeriods.status, "calculated"),
        sql`${schema.payslips.input}->'items' @> ${JSON.stringify([{ code: loanItemCode(loanId) }])}::jsonb`,
      ),
    )
    .limit(1);
  if (hit) throw new RuleError("loan_on_calculated_payslip");
}

async function findLoan(tx: Tx, loanId: string) {
  const [l] = await tx.select().from(loans).where(eq(loans.id, loanId));
  if (!l) throw new RuleError("not_found");
  return l;
}

export function makeListLoans(db: Db) {
  return createTenantAction(
    db,
    {
      permission: "payroll:read",
      /** periodId : mois ouvert pour lequel indiquer les échéances suspendues. */
      input: z.object({ employeeId: z.uuid(), periodId: z.uuid().optional() }),
      audit: "loans.list",
      skipAudit: true,
    },
    async ({ tx }, input) => {
      const rows = await tx
        .select()
        .from(loans)
        .where(eq(loans.employeeId, input.employeeId))
        .orderBy(asc(loans.createdAt));
      const history = rows.length
        ? await tx
            .select({
              loanId: repayments.loanId,
              amount: repayments.amount,
              year: schema.payPeriods.year,
              month: schema.payPeriods.month,
            })
            .from(repayments)
            .innerJoin(schema.payPeriods, eq(schema.payPeriods.id, repayments.periodId))
            .where(
              inArray(
                repayments.loanId,
                rows.map((r) => r.id),
              ),
            )
            .orderBy(asc(schema.payPeriods.year), asc(schema.payPeriods.month))
        : [];
      const skips = input.periodId
        ? new Set(
            (
              await tx
                .select({ key: schema.payVariables.key })
                .from(schema.payVariables)
                .where(
                  and(
                    eq(schema.payVariables.periodId, input.periodId),
                    eq(schema.payVariables.employeeId, input.employeeId),
                  ),
                )
            ).map((v) => v.key),
          )
        : new Set<string>();
      return rows.map((l) => {
        const paid = history.filter((h) => h.loanId === l.id);
        const repaid = paid.reduce((s, h) => s + h.amount, 0);
        return {
          id: l.id,
          kind: l.kind,
          label: l.label,
          principal: l.principal,
          installment: l.installment,
          grantedOn: l.grantedOn,
          start: { year: l.startYear, month: l.startMonth },
          status: l.status,
          repaid,
          remaining: l.principal - repaid,
          repayments: paid.map(({ amount, year, month }) => ({ amount, year, month })),
          skipped: skips.has(loanSkipKey(l.id)),
        };
      });
    },
  );
}

const money = z.coerce.number().int().min(1).max(100_000_000);

export function makeCreateLoan(db: Db) {
  return createTenantAction(
    db,
    {
      permission: "payroll:run",
      input: z
        .object({
          employeeId: z.uuid(),
          kind: z.enum(["loan", "advance"]),
          label: z.string().trim().min(1).max(80),
          principal: money,
          /** Avance : remboursée en une fois si la mensualité n'est pas précisée. */
          installment: money.optional(),
          grantedOn: z.iso.date(),
          start: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
        })
        .refine((v) => (v.installment ?? v.principal) <= v.principal, {
          path: ["installment"],
          message: "mensualité supérieure au montant",
        }),
      audit: "loans.create",
    },
    async ({ tx, tenantId, userId, audit }, input) => {
      const [emp] = await tx
        .select({ id: schema.employees.id, endDate: schema.employees.endDate })
        .from(schema.employees)
        .where(eq(schema.employees.id, input.employeeId));
      if (!emp) throw new RuleError("not_found");
      if (emp.endDate) throw new RuleError("employee_left");
      const [year, month] = input.start.split("-").map(Number) as [number, number];
      const [l] = await tx
        .insert(loans)
        .values({
          tenantId,
          employeeId: emp.id,
          kind: input.kind,
          label: input.label,
          principal: input.principal,
          installment: input.installment ?? input.principal,
          grantedOn: input.grantedOn,
          startYear: year,
          startMonth: month,
          createdBy: userId,
        })
        .returning({ id: loans.id });
      // Montants seulement : le libellé est saisi librement (jamais journalisé).
      audit({
        entityType: "employee_loan",
        entityId: l?.id ?? "",
        after: {
          kind: input.kind,
          principal: input.principal,
          installment: input.installment ?? input.principal,
          start: input.start,
        },
      });
      return { id: l?.id ?? "" };
    },
  );
}

export function makeUpdateLoanInstallment(db: Db) {
  return createTenantAction(
    db,
    {
      permission: "payroll:run",
      input: z.object({ loanId: z.uuid(), installment: money }),
      audit: "loans.update_installment",
    },
    async ({ tx, audit }, input) => {
      const l = await findLoan(tx, input.loanId);
      if (l.status !== "active") throw new RuleError("loan_closed");
      if (input.installment > l.principal) throw new RuleError("installment_too_high");
      await assertNotOnCalculatedPayslip(tx, l.id);
      await tx.update(loans).set({ installment: input.installment }).where(eq(loans.id, l.id));
      audit({
        entityType: "employee_loan",
        entityId: l.id,
        before: { installment: l.installment },
        after: { installment: input.installment },
      });
      return { id: l.id };
    },
  );
}

export function makeCancelLoan(db: Db) {
  return createTenantAction(
    db,
    {
      permission: "payroll:run",
      input: z.object({ loanId: z.uuid() }),
      audit: "loans.cancel",
    },
    async ({ tx, userId, audit }, input) => {
      const l = await findLoan(tx, input.loanId);
      if (l.status !== "active") throw new RuleError("loan_closed");
      await assertNotOnCalculatedPayslip(tx, l.id);
      await tx
        .update(loans)
        .set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: userId })
        .where(eq(loans.id, l.id));
      audit({ entityType: "employee_loan", entityId: l.id, after: { status: "cancelled" } });
      return { id: l.id };
    },
  );
}

/** Suspend (ou rétablit) l'échéance d'un prêt pour un mois de paie encore ouvert. */
export function makeSetLoanSkip(db: Db) {
  return createTenantAction(
    db,
    {
      permission: "payroll:run",
      input: z.object({ loanId: z.uuid(), periodId: z.uuid(), skip: z.boolean() }),
      audit: "loans.skip",
    },
    async ({ tx, tenantId, userId, audit }, input) => {
      const l = await findLoan(tx, input.loanId);
      if (l.status !== "active") throw new RuleError("loan_closed");
      const [p] = await tx
        .select()
        .from(schema.payPeriods)
        .where(eq(schema.payPeriods.id, input.periodId));
      if (!p) throw new RuleError("not_found");
      if (p.status !== "open") throw new RuleError("period_not_open");
      const key = loanSkipKey(l.id);
      const match = and(
        eq(schema.payVariables.periodId, p.id),
        eq(schema.payVariables.employeeId, l.employeeId),
        eq(schema.payVariables.key, key),
      );
      if (input.skip) {
        await tx
          .insert(schema.payVariables)
          .values({
            tenantId,
            periodId: p.id,
            employeeId: l.employeeId,
            key,
            value: 1,
            updatedBy: userId,
          })
          .onConflictDoNothing();
      } else {
        await tx.delete(schema.payVariables).where(match);
      }
      audit({
        entityType: "employee_loan",
        entityId: l.id,
        after: { periodId: p.id, skip: input.skip },
      });
      return { skip: input.skip };
    },
  );
}
