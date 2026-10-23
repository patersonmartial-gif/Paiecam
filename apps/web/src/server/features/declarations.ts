import { z } from "zod";
import { asc, eq, inArray, schema, type Db, type Tx } from "@paiecam/db";
import {
  buildCnpsStatement,
  buildDgiSummary,
  buildDipe,
  buildPayrollJournal,
  newVerificationCode,
  sha256Hex,
  signedMessage,
  type DeclarationSheetData,
  type DocumentStorage,
} from "@paiecam/documents";
import {
  aggregateDeclarations,
  declarationDueDate,
  resolveRule,
  type PayRule,
} from "@paiecam/paie-engine";
import { decryptField, signMessage, type Keyring } from "@paiecam/security";
import { createTenantAction, RuleError } from "../authz/action";

export const DECLARATION_KINDS = ["cnps", "dgi", "dipe"] as const;
export type DeclarationKind = (typeof DECLARATION_KINDS)[number];

const pad = (n: number) => String(n).padStart(2, "0");

async function findPeriod(tx: Tx, periodId: string) {
  const [p] = await tx.select().from(schema.payPeriods).where(eq(schema.payPeriods.id, periodId));
  if (!p) throw new RuleError("not_found");
  return p;
}

/** Données des états d'un mois validé, à partir des seuls bulletins figés. */
async function sheetData(
  tx: Tx,
  keyring: Keyring,
  periodId: string,
): Promise<DeclarationSheetData & { tenantId: string }> {
  const period = await findPeriod(tx, periodId);
  if (period.status !== "validated" && period.status !== "locked")
    throw new RuleError("period_not_validated");
  const [tenant] = await tx.select().from(schema.tenants);
  if (!tenant) throw new RuleError("not_found");
  const slips = await tx
    .select()
    .from(schema.payslips)
    .where(eq(schema.payslips.periodId, period.id));
  const ids = slips.map((s) => s.id);
  const lines = ids.length
    ? await tx
        .select()
        .from(schema.payslipLines)
        .where(inArray(schema.payslipLines.payslipId, ids))
        .orderBy(asc(schema.payslipLines.position))
    : [];
  const emps = slips.length
    ? await tx
        .select()
        .from(schema.employees)
        .where(
          inArray(
            schema.employees.id,
            slips.map((s) => s.employeeId),
          ),
        )
    : [];
  const linesOf = (slipId: string) => lines.filter((l) => l.payslipId === slipId);
  const totals = aggregateDeclarations(
    slips.map((s) => ({
      employeeId: s.employeeId,
      gross: s.gross,
      netPay: s.netPay,
      employerCost: s.employerCost,
      lines: linesOf(s.id),
    })),
  );
  return {
    tenantId: tenant.id,
    employer: {
      legalName: tenant.legalName,
      niu: tenant.niu,
      cnpsEmployerNumber: tenant.cnpsEmployerNumber,
      commune: tenant.commune,
    },
    period: { year: period.year, month: period.month },
    totals,
    employees: Object.fromEntries(
      slips.map((s) => {
        const e = emps.find((x) => x.id === s.employeeId);
        const snap = s.employeeSnapshot as {
          matricule: string;
          lastName: string;
          firstNames: string;
        };
        const cnps = e?.cnpsNumberEnc
          ? decryptField(
              keyring,
              { tenantId: tenant.id, table: "employees", column: "cnps_number", rowId: e.id },
              e.cnpsNumberEnc,
            )
          : null;
        return [
          s.employeeId,
          {
            ...snap,
            cnpsNumber: cnps,
            taxableGross: (s.totals as { taxableGross: number }).taxableGross,
          },
        ];
      }),
    ),
    journal: Object.fromEntries(
      slips.map((s) => [
        s.employeeId,
        linesOf(s.id).map((l) => ({ code: l.code, label: l.label, amount: l.amount })),
      ]),
    ),
  };
}

async function loadRules(tx: Tx): Promise<PayRule[]> {
  return (await tx.select().from(schema.payRules)).map((r) => ({
    id: r.id,
    code: r.code,
    validFrom: r.validFrom,
    validTo: r.validTo,
    value: r.value,
    status: r.status,
  }));
}

const BUILDERS: Record<DeclarationKind, (d: DeclarationSheetData) => Promise<Buffer>> = {
  cnps: buildCnpsStatement,
  dgi: buildDgiSummary,
  dipe: buildDipe,
};

/** Génère (ou régénère, tant que rien n'est déposé) les trois déclarations d'un mois validé. */
export function makeGenerateDeclarations(
  db: Db,
  deps: { keyring: Keyring; storage: DocumentStorage },
) {
  return createTenantAction(
    db,
    {
      permission: "declarations:generate",
      input: z.object({ periodId: z.uuid() }),
      audit: "declarations.generate",
    },
    async ({ tx, userId, audit }, input) => {
      const data = await sheetData(tx, deps.keyring, input.periodId);
      const period = await findPeriod(tx, input.periodId);
      if (period.status !== "validated") throw new RuleError("period_locked");
      const existing = await tx
        .select()
        .from(schema.declarations)
        .where(eq(schema.declarations.periodId, period.id));
      if (existing.some((d) => d.status !== "generated")) throw new RuleError("already_filed");
      const deadlines = resolveRule(
        await loadRules(tx),
        "echeances",
        `${period.year}-${pad(period.month)}-01`,
      ).value;
      const amounts: Record<DeclarationKind, number> = {
        cnps: data.totals.cnps.total,
        dgi: data.totals.dgi.total,
        dipe: 0,
      };

      for (const kind of DECLARATION_KINDS) {
        const file = await BUILDERS[kind](data);
        const code = newVerificationCode();
        const sha256 = sha256Hex(file);
        const issuedAt = new Date();
        const storageKey = `${data.tenantId}/${period.year}-${pad(period.month)}/declaration-${kind}-${code.toLowerCase()}.xlsx`;
        await deps.storage.put(storageKey, file);
        const [doc] = await tx
          .insert(schema.documents)
          .values({
            tenantId: data.tenantId,
            kind: `declaration_${kind}`,
            language: "fr",
            issuerName: data.employer.legalName,
            periodYear: period.year,
            periodMonth: period.month,
            storageKey,
            sizeBytes: file.length,
            sha256,
            signature: signMessage(
              deps.keyring,
              signedMessage(sha256, issuedAt.toISOString(), code),
            ),
            verificationCode: code,
            issuedAt,
          })
          .returning({ id: schema.documents.id });
        const values = {
          amountDue: amounts[kind],
          // La DIPE se dépose avec la déclaration fiscale.
          dueDate: declarationDueDate(
            deadlines,
            period.year,
            period.month,
            kind === "cnps" ? "cnps" : "dgi",
          ),
          documentId: doc?.id ?? "",
          updatedBy: userId,
          updatedAt: new Date(),
        };
        const prior = existing.find((d) => d.kind === kind);
        if (prior) {
          await tx
            .update(schema.declarations)
            .set(values)
            .where(eq(schema.declarations.id, prior.id));
        } else {
          await tx
            .insert(schema.declarations)
            .values({ ...values, tenantId: data.tenantId, periodId: period.id, kind });
        }
      }
      audit({
        entityType: "pay_period",
        entityId: period.id,
        after: { cnps: amounts.cnps, dgi: amounts.dgi, headcount: data.totals.headcount },
      });
      return { headcount: data.totals.headcount, cnps: amounts.cnps, dgi: amounts.dgi };
    },
  );
}

export function makeListDeclarations(db: Db) {
  return createTenantAction(
    db,
    {
      permission: "declarations:read",
      input: z.object({ periodId: z.uuid().optional() }),
      audit: "declarations.list",
      skipAudit: true,
    },
    async ({ tx }, input) => {
      const rows = await tx
        .select({
          id: schema.declarations.id,
          periodId: schema.declarations.periodId,
          kind: schema.declarations.kind,
          amountDue: schema.declarations.amountDue,
          dueDate: schema.declarations.dueDate,
          status: schema.declarations.status,
          documentId: schema.declarations.documentId,
          filedAt: schema.declarations.filedAt,
          filingReference: schema.declarations.filingReference,
          paidAt: schema.declarations.paidAt,
          paymentReference: schema.declarations.paymentReference,
          year: schema.payPeriods.year,
          month: schema.payPeriods.month,
          periodStatus: schema.payPeriods.status,
        })
        .from(schema.declarations)
        .innerJoin(schema.payPeriods, eq(schema.payPeriods.id, schema.declarations.periodId))
        .where(input.periodId ? eq(schema.declarations.periodId, input.periodId) : undefined)
        .orderBy(asc(schema.declarations.dueDate), asc(schema.declarations.kind));
      return rows;
    },
  );
}

const isoDate = z.iso.date();
const reference = z.string().trim().min(2).max(100);

export function makeMarkFiled(db: Db) {
  return createTenantAction(
    db,
    {
      permission: "declarations:generate",
      input: z.object({ declarationId: z.uuid(), filedAt: isoDate, reference }),
      audit: "declarations.filed",
    },
    async ({ tx, userId, audit }, input) => {
      const [d] = await tx
        .select()
        .from(schema.declarations)
        .where(eq(schema.declarations.id, input.declarationId));
      if (!d) throw new RuleError("not_found");
      if (d.status !== "generated") throw new RuleError("already_filed");
      if (input.filedAt > new Date().toISOString().slice(0, 10))
        throw new RuleError("date_in_future");
      await tx
        .update(schema.declarations)
        .set({
          status: "filed",
          filedAt: input.filedAt,
          filingReference: input.reference,
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(eq(schema.declarations.id, d.id));
      audit({
        entityType: "declaration",
        entityId: d.id,
        after: { kind: d.kind, filedAt: input.filedAt, reference: input.reference },
      });
      return { id: d.id, late: input.filedAt > d.dueDate };
    },
  );
}

export function makeMarkPaid(db: Db) {
  return createTenantAction(
    db,
    {
      permission: "declarations:generate",
      input: z.object({
        declarationId: z.uuid(),
        paidAt: isoDate,
        reference: reference.optional(),
      }),
      audit: "declarations.paid",
    },
    async ({ tx, userId, audit }, input) => {
      const [d] = await tx
        .select()
        .from(schema.declarations)
        .where(eq(schema.declarations.id, input.declarationId));
      if (!d) throw new RuleError("not_found");
      if (d.status !== "filed")
        throw new RuleError(d.status === "paid" ? "already_paid" : "not_filed");
      if (input.paidAt > new Date().toISOString().slice(0, 10))
        throw new RuleError("date_in_future");
      await tx
        .update(schema.declarations)
        .set({
          status: "paid",
          paidAt: input.paidAt,
          paymentReference: input.reference ?? null,
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(eq(schema.declarations.id, d.id));
      audit({
        entityType: "declaration",
        entityId: d.id,
        after: { kind: d.kind, paidAt: input.paidAt },
      });
      return { id: d.id };
    },
  );
}

export function makeLockPeriod(db: Db) {
  return createTenantAction(
    db,
    {
      permission: "payroll:validate",
      input: z.object({ periodId: z.uuid() }),
      audit: "payroll.lock",
    },
    async ({ tx, audit }, input) => {
      const period = await findPeriod(tx, input.periodId);
      if (period.status !== "validated") throw new RuleError("period_not_validated");
      const decl = await tx
        .select()
        .from(schema.declarations)
        .where(eq(schema.declarations.periodId, period.id));
      if (decl.length < DECLARATION_KINDS.length || decl.some((d) => d.status === "generated"))
        throw new RuleError("declarations_not_filed");
      await tx
        .update(schema.payPeriods)
        .set({ status: "locked", lockedAt: new Date() })
        .where(eq(schema.payPeriods.id, period.id));
      audit({ entityType: "pay_period", entityId: period.id });
      return { periodId: period.id };
    },
  );
}

/** Journal de paie à la demande (non déposé, non stocké) ; l'export est audité. */
export function makeExportJournal(db: Db, keyring: Keyring) {
  return createTenantAction(
    db,
    {
      permission: "payroll:read",
      input: z.object({ periodId: z.uuid() }),
      audit: "payroll.export_journal",
    },
    async ({ tx, audit }, input) => {
      const data = await sheetData(tx, keyring, input.periodId);
      audit({ entityType: "pay_period", entityId: input.periodId });
      return {
        file: await buildPayrollJournal(data),
        filename: `journal-paie-${data.period.year}-${pad(data.period.month)}.xlsx`,
      };
    },
  );
}
