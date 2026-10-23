import { z } from "zod";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  isNull,
  lte,
  or,
  schema,
  sql,
  type Db,
  type Tx,
} from "@paiecam/db";
import {
  computePayslip,
  type PayItemInput,
  type PayRule,
  type PayslipInput,
} from "@paiecam/paie-engine";
import { createTenantAction, RuleError } from "../authz/action";

/** Rubriques proposées à chaque entreprise (modifiables) : des libellés, aucun taux. */
export const DEFAULT_PAY_ITEMS = [
  {
    code: "prime_rendement",
    labelFr: "Prime de rendement",
    labelEn: "Performance bonus",
    kind: "earning",
    subjectToCnps: true,
    taxable: true,
  },
  {
    code: "prime_anciennete",
    labelFr: "Prime d'ancienneté",
    labelEn: "Seniority bonus",
    kind: "earning",
    subjectToCnps: true,
    taxable: true,
  },
  {
    code: "indemnite_logement",
    labelFr: "Indemnité de logement",
    labelEn: "Housing allowance",
    kind: "earning",
    subjectToCnps: true,
    taxable: true,
  },
  {
    code: "avantage_logement",
    labelFr: "Avantage en nature logement",
    labelEn: "Housing benefit in kind",
    kind: "in_kind",
    subjectToCnps: true,
    taxable: true,
  },
  {
    code: "indemnite_transport",
    labelFr: "Indemnité de transport",
    labelEn: "Transport allowance",
    kind: "non_taxable_allowance",
    subjectToCnps: false,
    taxable: false,
  },
  {
    code: "avance",
    labelFr: "Avance sur salaire",
    labelEn: "Salary advance",
    kind: "deduction",
    subjectToCnps: false,
    taxable: false,
  },
  {
    code: "pret",
    labelFr: "Remboursement de prêt",
    labelEn: "Loan repayment",
    kind: "deduction",
    subjectToCnps: false,
    taxable: false,
  },
] as const;

/** Catégories d'heures supplémentaires saisissables (leurs taux viennent de pay_rules). */
export const OVERTIME_CATEGORIES = ["hs_20", "hs_30", "hs_40", "hs_50"] as const;

export interface PayrollDeps {
  /** Autorise le calcul avec des règles en brouillon (bulletins « provisoires »). Jamais en production sans pilote. */
  allowDraftRules: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");
function periodBounds(year: number, month: number) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: `${year}-${pad(month)}-01`, end: `${year}-${pad(month)}-${pad(last)}` };
}

async function ensureDefaultItems(tx: Tx, tenantId: string) {
  await tx
    .insert(schema.payItems)
    .values(DEFAULT_PAY_ITEMS.map((i) => ({ ...i, tenantId })))
    .onConflictDoNothing({ target: [schema.payItems.tenantId, schema.payItems.code] });
}

async function findPeriod(tx: Tx, periodId: string) {
  const [p] = await tx.select().from(schema.payPeriods).where(eq(schema.payPeriods.id, periodId));
  if (!p) throw new RuleError("not_found");
  return p;
}

/** Salariés sous contrat pendant au moins un jour du mois (y compris sortis dans le mois). */
async function employeesInPeriod(tx: Tx, start: string, end: string) {
  return tx
    .select()
    .from(schema.employees)
    .where(
      and(
        lte(schema.employees.hireDate, end),
        or(isNull(schema.employees.endDate), gte(schema.employees.endDate, start)),
      ),
    )
    .orderBy(asc(schema.employees.lastName), asc(schema.employees.firstNames));
}

async function loadRules(tx: Tx): Promise<PayRule[]> {
  const rows = await tx.select().from(schema.payRules);
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    validFrom: r.validFrom,
    validTo: r.validTo,
    value: r.value,
    status: r.status,
  }));
}

export function makeListPeriods(db: Db) {
  return createTenantAction(
    db,
    {
      permission: "payroll:read",
      input: z.object({}),
      audit: "payroll.list_periods",
      skipAudit: true,
    },
    async ({ tx }) =>
      tx
        .select()
        .from(schema.payPeriods)
        .orderBy(desc(schema.payPeriods.year), desc(schema.payPeriods.month))
        .limit(36),
  );
}

export function makeOpenPeriod(db: Db) {
  return createTenantAction(
    db,
    {
      permission: "payroll:run",
      input: z.object({
        year: z.coerce.number().int().min(2020).max(2100),
        month: z.coerce.number().int().min(1).max(12),
      }),
      audit: "payroll.open_period",
    },
    async ({ tx, tenantId, audit }, input) => {
      await ensureDefaultItems(tx, tenantId);
      const [p] = await tx
        .insert(schema.payPeriods)
        .values({ tenantId, year: input.year, month: input.month })
        .returning({ id: schema.payPeriods.id });
      audit({ entityType: "pay_period", entityId: p?.id ?? "", after: input });
      return { periodId: p?.id ?? "" };
    },
  );
}

export function makeGetPeriod(db: Db) {
  return createTenantAction(
    db,
    {
      permission: "payroll:read",
      input: z.object({ periodId: z.uuid() }),
      audit: "payroll.read_period",
      skipAudit: true,
    },
    async ({ tx, tenantId }, input) => {
      const period = await findPeriod(tx, input.periodId);
      await ensureDefaultItems(tx, tenantId);
      const { start, end } = periodBounds(period.year, period.month);
      const [emps, items, variables, slips] = await Promise.all([
        employeesInPeriod(tx, start, end),
        tx
          .select()
          .from(schema.payItems)
          .where(eq(schema.payItems.active, true))
          .orderBy(asc(schema.payItems.kind), asc(schema.payItems.code)),
        tx.select().from(schema.payVariables).where(eq(schema.payVariables.periodId, period.id)),
        tx
          .select({
            id: schema.payslips.id,
            employeeId: schema.payslips.employeeId,
            status: schema.payslips.status,
            gross: schema.payslips.gross,
            netPay: schema.payslips.netPay,
            employerCost: schema.payslips.employerCost,
            warnings: schema.payslips.warnings,
          })
          .from(schema.payslips)
          .where(eq(schema.payslips.periodId, period.id)),
      ]);
      return {
        period: { ...period, start, end },
        employees: emps.map((e) => ({
          id: e.id,
          matricule: e.matricule,
          name: `${e.lastName} ${e.firstNames}`,
          baseSalary: e.baseSalary,
          hasCnpsNumber: e.cnpsNumberEnc !== null,
        })),
        items: items.map((i) => ({
          code: i.code,
          labelFr: i.labelFr,
          labelEn: i.labelEn,
          kind: i.kind,
        })),
        overtimeCategories: OVERTIME_CATEGORIES,
        variables: variables.map((v) => ({ employeeId: v.employeeId, key: v.key, value: v.value })),
        payslips: slips.map((s) => ({ ...s, warnings: s.warnings as string[] })),
      };
    },
  );
}

const variableEntry = z.object({
  employeeId: z.uuid(),
  key: z.string().regex(/^(item:[a-z0-9_]{1,40}|hs:[a-z0-9_]{1,20}|absence)$/),
  value: z.coerce.number().int().min(0).max(100_000_000),
});

export function makeSaveVariables(db: Db) {
  return createTenantAction(
    db,
    {
      permission: "payroll:run",
      input: z.object({ periodId: z.uuid(), entries: z.array(variableEntry).max(10_000) }),
      audit: "payroll.save_variables",
    },
    async ({ tx, tenantId, userId, audit }, input) => {
      const period = await findPeriod(tx, input.periodId);
      if (period.status !== "open") throw new RuleError("period_not_open");
      const { start, end } = periodBounds(period.year, period.month);
      const allowedEmployees = new Set((await employeesInPeriod(tx, start, end)).map((e) => e.id));
      const itemCodes = new Set(
        (await tx.select({ c: schema.payItems.code }).from(schema.payItems)).map((r) => r.c),
      );
      for (const e of input.entries) {
        if (!allowedEmployees.has(e.employeeId)) throw new RuleError("employee_not_in_period");
        if (e.key.startsWith("item:") && !itemCodes.has(e.key.slice(5)))
          throw new RuleError("unknown_item");
        if (
          e.key.startsWith("hs:") &&
          !(OVERTIME_CATEGORIES as readonly string[]).includes(e.key.slice(3))
        ) {
          throw new RuleError("unknown_overtime");
        }
      }
      const toDelete = input.entries.filter((e) => e.value === 0);
      const toUpsert = input.entries.filter((e) => e.value > 0);
      for (const e of toDelete) {
        await tx
          .delete(schema.payVariables)
          .where(
            and(
              eq(schema.payVariables.periodId, period.id),
              eq(schema.payVariables.employeeId, e.employeeId),
              eq(schema.payVariables.key, e.key),
            ),
          );
      }
      if (toUpsert.length > 0) {
        await tx
          .insert(schema.payVariables)
          .values(toUpsert.map((e) => ({ ...e, tenantId, periodId: period.id, updatedBy: userId })))
          .onConflictDoUpdate({
            target: [
              schema.payVariables.periodId,
              schema.payVariables.employeeId,
              schema.payVariables.key,
            ],
            set: { value: sql`excluded.value`, updatedBy: userId, updatedAt: new Date() },
          });
      }
      audit({
        entityType: "pay_period",
        entityId: period.id,
        after: { saved: toUpsert.length, cleared: toDelete.length },
      });
      return { saved: toUpsert.length, cleared: toDelete.length };
    },
  );
}

/** Écart de net au-delà duquel une alerte est levée par rapport au mois précédent. */
const NET_VARIATION_ALERT = 0.2;

export function makeCalculatePeriod(db: Db, deps: PayrollDeps) {
  return createTenantAction(
    db,
    {
      permission: "payroll:run",
      input: z.object({ periodId: z.uuid() }),
      audit: "payroll.calculate",
    },
    async ({ tx, audit }, input) => {
      const period = await findPeriod(tx, input.periodId);
      if (period.status !== "open" && period.status !== "calculated")
        throw new RuleError("period_frozen");
      const { start, end } = periodBounds(period.year, period.month);
      const [tenant] = await tx.select().from(schema.tenants);
      if (!tenant) throw new RuleError("not_found");
      const rules = await loadRules(tx);
      const emps = await employeesInPeriod(tx, start, end);
      const items = new Map((await tx.select().from(schema.payItems)).map((i) => [i.code, i]));
      const variables = await tx
        .select()
        .from(schema.payVariables)
        .where(eq(schema.payVariables.periodId, period.id));

      // Net du mois précédent, pour l'alerte de variation.
      const prevMonth =
        period.month === 1
          ? { year: period.year - 1, month: 12 }
          : { year: period.year, month: period.month - 1 };
      const [prev] = await tx
        .select({ id: schema.payPeriods.id })
        .from(schema.payPeriods)
        .where(
          and(
            eq(schema.payPeriods.year, prevMonth.year),
            eq(schema.payPeriods.month, prevMonth.month),
          ),
        );
      const prevNet = new Map(
        prev
          ? (
              await tx
                .select({ e: schema.payslips.employeeId, n: schema.payslips.netPay })
                .from(schema.payslips)
                .where(eq(schema.payslips.periodId, prev.id))
            ).map((r) => [r.e, r.n])
          : [],
      );

      await tx.delete(schema.payslips).where(eq(schema.payslips.periodId, period.id));

      let provisional = 0;
      const summary: { employeeId: string; netPay: number; warnings: string[] }[] = [];
      for (const e of emps) {
        const mine = variables.filter((v) => v.employeeId === e.id);
        const payItems: PayItemInput[] = mine
          .filter((v) => v.key.startsWith("item:"))
          .map((v) => {
            const item = items.get(v.key.slice(5));
            if (!item) throw new RuleError("unknown_item");
            return {
              code: item.code,
              label: item.labelFr,
              kind: item.kind,
              amount: v.value,
              subjectToCnps: item.subjectToCnps,
              taxable: item.taxable,
            };
          });
        const engineInput: PayslipInput = {
          period: { start, end },
          employer: { regime: tenant.regime, workAccidentRate: tenant.workAccidentRate },
          employee: { baseSalary: e.baseSalary, hireDate: e.hireDate, endDate: e.endDate },
          items: payItems,
          overtime: mine
            .filter((v) => v.key.startsWith("hs:"))
            .map((v) => ({ category: v.key.slice(3), hoursHundredths: v.value })),
          unpaidAbsenceDays: mine.find((v) => v.key === "absence")?.value ?? 0,
        };
        let result;
        try {
          result = computePayslip(engineInput, rules);
        } catch (err) {
          throw new RuleError(`calculation_failed:${e.matricule}:${(err as Error).message}`);
        }
        const isFinal = result.rulesUsed.every((r) => r.status === "validated");
        if (!isFinal && !deps.allowDraftRules) throw new RuleError("draft_rules");
        if (!isFinal) provisional++;

        const warnings: string[] = [...result.warnings];
        if (e.cnpsNumberEnc === null) warnings.push("missing_cnps_number");
        const before = prevNet.get(e.id);
        if (
          before !== undefined &&
          before > 0 &&
          Math.abs(result.totals.netPay - before) / before > NET_VARIATION_ALERT
        ) {
          warnings.push("net_variation");
        }

        const [slip] = await tx
          .insert(schema.payslips)
          .values({
            tenantId: tenant.id,
            periodId: period.id,
            employeeId: e.id,
            status: isFinal ? "final" : "provisional",
            input: engineInput,
            employeeSnapshot: {
              matricule: e.matricule,
              lastName: e.lastName,
              firstNames: e.firstNames,
              jobTitle: e.jobTitle,
              category: e.category,
              echelon: e.echelon,
              hireDate: e.hireDate,
              contractType: e.contractType,
              cnpsNumberLast4: e.cnpsNumberLast4,
              language: e.payslipLanguage,
            },
            rulesUsed: result.rulesUsed,
            totals: result.totals,
            warnings,
            gross: result.totals.gross,
            netPay: result.totals.netPay,
            employerCost: result.totals.employerCost,
          })
          .returning({ id: schema.payslips.id });
        await tx.insert(schema.payslipLines).values(
          result.lines.map((l, i) => ({
            tenantId: tenant.id,
            payslipId: slip?.id ?? "",
            position: i + 1,
            code: l.code,
            label: l.label,
            section: l.section,
            base: l.base ?? null,
            rate: l.rate ?? null,
            amount: l.amount,
            ruleCode: l.ruleCode ?? null,
            explanation: l.explanation,
          })),
        );
        summary.push({ employeeId: e.id, netPay: result.totals.netPay, warnings });
      }

      if (period.status === "open") {
        await tx
          .update(schema.payPeriods)
          .set({ status: "calculated", calculatedAt: new Date() })
          .where(eq(schema.payPeriods.id, period.id));
      } else {
        await tx
          .update(schema.payPeriods)
          .set({ calculatedAt: new Date() })
          .where(eq(schema.payPeriods.id, period.id));
      }
      audit({
        entityType: "pay_period",
        entityId: period.id,
        after: { payslips: emps.length, provisional },
      });
      return {
        payslips: emps.length,
        provisional,
        warnings: summary.filter((s) => s.warnings.length > 0).length,
      };
    },
  );
}

export function makeReopenPeriod(db: Db) {
  return createTenantAction(
    db,
    { permission: "payroll:run", input: z.object({ periodId: z.uuid() }), audit: "payroll.reopen" },
    async ({ tx, audit }, input) => {
      const period = await findPeriod(tx, input.periodId);
      if (period.status !== "calculated") throw new RuleError("period_not_calculated");
      // Les bulletins calculés deviennent obsolètes dès qu'on modifie les variables.
      await tx.delete(schema.payslips).where(eq(schema.payslips.periodId, period.id));
      await tx
        .update(schema.payPeriods)
        .set({ status: "open" })
        .where(eq(schema.payPeriods.id, period.id));
      audit({ entityType: "pay_period", entityId: period.id });
      return { periodId: period.id };
    },
  );
}

export function makeValidatePeriod(
  db: Db,
  deps: {
    verifyPassword: (userId: string, password: string) => Promise<boolean>;
    onValidated?: (periodId: string, tenantId: string) => Promise<void>;
  },
) {
  return createTenantAction(
    db,
    {
      permission: "payroll:validate",
      input: z.object({ periodId: z.uuid(), password: z.string().min(1).max(128) }),
      audit: "payroll.validate",
    },
    async ({ tx, tenantId, userId, audit }, input) => {
      if (!(await deps.verifyPassword(userId, input.password))) throw new RuleError("bad_password");
      const period = await findPeriod(tx, input.periodId);
      if (period.status !== "calculated") throw new RuleError("period_not_calculated");
      const slips = await tx
        .select({ s: schema.payslips.status })
        .from(schema.payslips)
        .where(eq(schema.payslips.periodId, period.id));
      if (slips.length === 0) throw new RuleError("no_payslips");
      if (slips.some((s) => s.s !== "final")) throw new RuleError("provisional_payslips");
      await tx
        .update(schema.payPeriods)
        .set({ status: "validated", validatedAt: new Date(), validatedBy: userId })
        .where(eq(schema.payPeriods.id, period.id));
      await deps.onValidated?.(period.id, tenantId);
      audit({ entityType: "pay_period", entityId: period.id, after: { payslips: slips.length } });
      return { periodId: period.id };
    },
  );
}

export function makeGetPayslip(db: Db) {
  return createTenantAction(
    db,
    {
      permission: "payroll:read",
      input: z.object({ payslipId: z.uuid() }),
      audit: "payroll.read_payslip",
      skipAudit: true,
    },
    async ({ tx }, input) => {
      const [slip] = await tx
        .select()
        .from(schema.payslips)
        .where(eq(schema.payslips.id, input.payslipId));
      if (!slip) throw new RuleError("not_found");
      const lines = await tx
        .select()
        .from(schema.payslipLines)
        .where(eq(schema.payslipLines.payslipId, slip.id))
        .orderBy(asc(schema.payslipLines.position));
      const period = await findPeriod(tx, slip.periodId);
      return { slip, lines, period };
    },
  );
}

export { periodBounds };
