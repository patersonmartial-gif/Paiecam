import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDb,
  createTenantWithOwner,
  eq,
  schema,
  withTenant,
  withUser,
  type NewTenant,
} from "@paiecam/db";
import { loadTestRules, testDatabaseUrl, validateAllTestRules } from "@paiecam/db/testing";
import { loadRuleFile } from "@paiecam/paie-engine/rules";
import { parseKeyring } from "@paiecam/security";
import type { RequestContext } from "@/server/authz/action";
import { makeArchiveEmployee, makeCreateEmployee } from "@/server/features/employees";
import {
  makeCancelLoan,
  makeCreateLoan,
  makeListLoans,
  makeSetLoanSkip,
  makeUpdateLoanInstallment,
} from "@/server/features/loans";
import {
  makeCalculatePeriod,
  makeGetPayslip,
  makeGetPeriod,
  makeOpenPeriod,
  makeReopenPeriod,
  makeValidatePeriod,
} from "@/server/features/payroll";

const db = createDb(testDatabaseUrl());
const keyring = parseKeyring(`v1:${Buffer.alloc(32, 13).toString("base64")}`);
const createLoan = makeCreateLoan(db);
const listLoans = makeListLoans(db);
const cancelLoan = makeCancelLoan(db);
const setSkip = makeSetLoanSkip(db);
const updateInstallment = makeUpdateLoanInstallment(db);
const openPeriod = makeOpenPeriod(db);
const calculate = makeCalculatePeriod(db, { allowDraftRules: false });
const reopen = makeReopenPeriod(db);
const validate = makeValidatePeriod(db, { verifyPassword: async () => true });
const getPeriod = makeGetPeriod(db);
const getPayslip = makeGetPayslip(db);

const fake = (n: string): NewTenant => ({
  legalName: `Boulangerie fictive ${n}`,
  niu: `B0000000000${n}`,
  cnpsEmployerNumber: `000-000000-${n}`,
  regime: "general",
  workAccidentRate: 175,
  commune: "Limbé 1er",
});
const U = { owner: "ln-owner", accountant: "ln-accountant", ownerB: "ln-owner-b" };
let A = "";
let B = "";
let emp = "";
const ctx = (userId: string, tenantId = A): RequestContext => ({
  user: { id: userId, twoFactorEnabled: true },
  tenantId,
  ip: "203.0.113.80",
  userAgent: "vitest",
});
const ok = <T>(r: { ok: true; data: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.data;
};
const rule = (reason: string) => ({ ok: false, error: { code: "RULE", reason } });

async function createEmployee(matricule: string, baseSalary = "400000") {
  return ok(
    await makeCreateEmployee(db, keyring)(ctx(U.owner), {
      matricule,
      lastName: "FICTIF",
      firstNames: "Jean",
      birthDate: "1985-05-05",
      cnpsNumber: "",
      hireDate: "2024-01-15",
      contractType: "cdi",
      endDate: "",
      jobTitle: "Boulanger",
      category: "4",
      echelon: "A",
      baseSalary,
      maritalStatus: "single",
      childrenCount: "0",
      paymentMethod: "cash",
    }),
  ).id;
}

/** Ouvre, calcule et (sauf demande) valide un mois ; renvoie les lignes de prêt du bulletin. */
async function runMonth(month: number, options: { validate?: boolean; employee?: string } = {}) {
  const periodId = ok(await openPeriod(ctx(U.owner), { year: 2026, month })).periodId;
  ok(await calculate(ctx(U.owner), { periodId }));
  const slip = ok(await getPeriod(ctx(U.owner), { periodId })).payslips.find(
    (s) => s.employeeId === (options.employee ?? emp),
  );
  const detail = ok(await getPayslip(ctx(U.owner), { payslipId: slip?.id ?? "" }));
  if (options.validate !== false) ok(await validate(ctx(U.owner), { periodId, password: "x" }));
  return {
    periodId,
    warnings: slip?.warnings ?? [],
    loanLines: detail.lines
      .filter((l) => l.code.startsWith("item.loan:"))
      .map((l) => ({ label: l.label, amount: l.amount })),
  };
}

const loan = (over: Record<string, unknown> = {}) => ({
  employeeId: emp,
  kind: "loan",
  label: "Prêt scolarité",
  principal: "100000",
  installment: "40000",
  grantedOn: "2025-12-20",
  start: "2026-01",
  ...over,
});
let loanId = "";

beforeAll(async () => {
  await loadTestRules(
    loadRuleFile(
      new URL("../../../packages/paie-engine/rules/cm-2026.draft.json", import.meta.url).pathname,
    ),
  );
  await validateAllTestRules();
  await db
    .insert(schema.users)
    .values(Object.values(U).map((id) => ({ id, name: id, email: `${id}@exemple.test` })));
  A = await withUser(db, U.owner, (tx) => createTenantWithOwner(tx, U.owner, fake("A")));
  B = await withUser(db, U.ownerB, (tx) => createTenantWithOwner(tx, U.ownerB, fake("B")));
  await withTenant(db, { tenantId: A, userId: U.owner }, (tx) =>
    tx.insert(schema.memberships).values({ tenantId: A, userId: U.accountant, role: "accountant" }),
  );
  emp = await createEmployee("BL-1");
});

afterAll(async () => {
  await db.$client.end();
});

describe("prêts et avances", () => {
  it("création : contrôles, droits et isolation", async () => {
    expect(await createLoan(ctx(U.owner), loan({ installment: "100001" }))).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
    expect(await createLoan(ctx(U.accountant), loan())).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    // B ne prête pas à un salarié de A (introuvable dans son entreprise).
    expect(await createLoan(ctx(U.ownerB, B), loan())).toEqual(rule("not_found"));
    loanId = ok(await createLoan(ctx(U.owner), loan())).id;
    expect(await listLoans(ctx(U.ownerB, B), { employeeId: emp })).toEqual({ ok: true, data: [] });
    expect(ok(await listLoans(ctx(U.accountant), { employeeId: emp }))).toMatchObject([
      { principal: 100_000, installment: 40_000, repaid: 0, remaining: 100_000, status: "active" },
    ]);
  });

  it("janvier : 1re échéance retenue, enregistrée à la validation", async () => {
    const jan = await runMonth(1);
    expect(jan.loanLines).toEqual([{ label: "Prêt scolarité — échéance 1/3", amount: 40_000 }]);
    expect(ok(await listLoans(ctx(U.owner), { employeeId: emp }))[0]).toMatchObject({
      repaid: 40_000,
      remaining: 60_000,
      repayments: [{ year: 2026, month: 1, amount: 40_000 }],
    });
  });

  it("février : échéance suspendue, rien n'est retenu ni remboursé", async () => {
    const periodId = ok(await openPeriod(ctx(U.owner), { year: 2026, month: 2 })).periodId;
    ok(await setSkip(ctx(U.owner), { loanId, periodId, skip: true }));
    ok(await calculate(ctx(U.owner), { periodId }));
    const slip = ok(await getPeriod(ctx(U.owner), { periodId })).payslips[0];
    const lines = ok(await getPayslip(ctx(U.owner), { payslipId: slip?.id ?? "" })).lines;
    expect(lines.some((l) => l.code.startsWith("item.loan:"))).toBe(false);
    // La suspension ne se change plus une fois le mois calculé.
    expect(await setSkip(ctx(U.owner), { loanId, periodId, skip: false })).toEqual(
      rule("period_not_open"),
    );
    ok(await validate(ctx(U.owner), { periodId, password: "x" }));
    expect(ok(await listLoans(ctx(U.owner), { employeeId: emp }))[0]?.remaining).toBe(60_000);
  });

  it("un prêt sur un bulletin calculé ne change pas tant que le mois n'est pas rouvert", async () => {
    const mar = await runMonth(3, { validate: false });
    expect(mar.loanLines).toEqual([{ label: "Prêt scolarité — échéance 2/3", amount: 40_000 }]);
    expect(await cancelLoan(ctx(U.owner), { loanId })).toEqual(rule("loan_on_calculated_payslip"));
    expect(await updateInstallment(ctx(U.owner), { loanId, installment: 30_000 })).toEqual(
      rule("loan_on_calculated_payslip"),
    );
    ok(await reopen(ctx(U.owner), { periodId: mar.periodId }));
    ok(await updateInstallment(ctx(U.owner), { loanId, installment: 30_000 }));
    ok(await calculate(ctx(U.owner), { periodId: mar.periodId }));
    ok(await validate(ctx(U.owner), { periodId: mar.periodId, password: "x" }));
    expect(ok(await listLoans(ctx(U.owner), { employeeId: emp }))[0]).toMatchObject({
      installment: 30_000,
      remaining: 30_000,
    });
  });

  it("avril : dernière échéance = reste dû, prêt soldé, plus aucune retenue ensuite", async () => {
    const apr = await runMonth(4);
    expect(apr.loanLines).toEqual([{ label: "Prêt scolarité — échéance 3/3", amount: 30_000 }]);
    expect(ok(await listLoans(ctx(U.owner), { employeeId: emp }))[0]).toMatchObject({
      status: "settled",
      remaining: 0,
    });
    expect(await cancelLoan(ctx(U.owner), { loanId })).toEqual(rule("loan_closed"));
    expect((await runMonth(5)).loanLines).toEqual([]);
  });

  it("validation refusée si un prêt a été annulé après le calcul (recalcul exigé)", async () => {
    const other = ok(await createLoan(ctx(U.owner), loan({ start: "2026-06" }))).id;
    const jun = await runMonth(6, { validate: false });
    expect(jun.loanLines).toHaveLength(1);
    // Annulation directe en base (contourne le garde-fou de l'action) : la validation le détecte.
    await withTenant(db, { tenantId: A, userId: U.owner }, (tx) =>
      tx
        .update(schema.employeeLoans)
        .set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: U.owner })
        .where(eq(schema.employeeLoans.id, other)),
    );
    expect(await validate(ctx(U.owner), { periodId: jun.periodId, password: "x" })).toEqual(
      rule("loans_changed"),
    );
  });

  it("avertissements : plafond des retenues dépassé, solde dû à la sortie", async () => {
    const small = await createEmployee("BL-2", "150000");
    ok(
      await createLoan(
        ctx(U.owner),
        loan({ employeeId: small, principal: "300000", installment: "100000", start: "2026-07" }),
      ),
    );
    ok(await makeArchiveEmployee(db)(ctx(U.owner), { id: small, endDate: "2026-07-31" }));
    const jul = await runMonth(7, { validate: false, employee: small });
    expect(jul.loanLines).toEqual([{ label: "Prêt scolarité — échéance 1/3", amount: 100_000 }]);
    expect(jul.warnings).toEqual(
      expect.arrayContaining(["deductions_above_limit", "loan_balance_at_exit"]),
    );
    // Salarié sorti : plus de nouveau prêt.
    expect(await createLoan(ctx(U.owner), loan({ employeeId: small }))).toEqual(
      rule("employee_left"),
    );
  });
});
