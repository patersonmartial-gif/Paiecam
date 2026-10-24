import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { createTenantWithOwner, withTenant, withUser, type NewTenant, type Tx } from "../src";
import { employeeLoans, employees, loanRepayments, payPeriods, users } from "../src/schema";
import { db } from "./db";

const fake = (n: string): NewTenant => ({
  legalName: `Prêts fictifs ${n}`,
  niu: `L0000000000${n}`,
  cnpsEmployerNumber: `000-000000-${n}`,
  regime: "general",
  workAccidentRate: 175,
  commune: "Kribi 1er",
});
let A = "";
let B = "";
const asA = <T>(fn: (tx: Tx) => Promise<T>) =>
  withTenant(db, { tenantId: A, userId: "loan-owner-a" }, fn);
const asB = <T>(fn: (tx: Tx) => Promise<T>) =>
  withTenant(db, { tenantId: B, userId: "loan-owner-b" }, fn);

async function pgError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const err = e as Error & { cause?: Error };
    return err.cause?.message ?? err.message;
  }
  return "aucune erreur";
}

const employee = (tenantId: string) => ({
  id: uuidv7(),
  tenantId,
  matricule: `P-${Math.random().toString(36).slice(2, 8)}`,
  lastName: "Fictif",
  firstNames: "Prêt",
  birthDate: "1990-01-01",
  hireDate: "2024-01-01",
  contractType: "cdi" as const,
  jobTitle: "Agent",
  category: "3",
  echelon: "A",
  baseSalary: 150_000,
  maritalStatus: "single" as const,
  paymentMethod: "cash" as const,
});
let empA = "";
let empB = "";
const periods: Record<string, string> = {};

/** Mois de paie de A, au statut voulu (validé sans bulletin : suffisant pour ces contrôles). */
async function period(month: number, status: "open" | "validated") {
  const [p] = await asA((tx) =>
    tx.insert(payPeriods).values({ tenantId: A, year: 2026, month }).returning(),
  );
  const id = p?.id ?? "";
  if (status === "validated") {
    await asA((tx) =>
      tx.update(payPeriods).set({ status: "calculated" }).where(eq(payPeriods.id, id)),
    );
    await asA((tx) =>
      tx
        .update(payPeriods)
        .set({ status: "validated", validatedAt: new Date(), validatedBy: "loan-owner-a" })
        .where(eq(payPeriods.id, id)),
    );
  }
  return id;
}

const newLoan = (principal = 90_000, installment = 30_000) =>
  asA(async (tx) => {
    const [l] = await tx
      .insert(employeeLoans)
      .values({
        tenantId: A,
        employeeId: empA,
        kind: "loan",
        label: "Prêt fictif",
        principal,
        installment,
        grantedOn: "2026-01-10",
        startYear: 2026,
        startMonth: 1,
        createdBy: "loan-owner-a",
      })
      .returning();
    return l?.id ?? "";
  });
const repay = (loanId: string, periodId: string, amount: number) =>
  asA((tx) => tx.insert(loanRepayments).values({ tenantId: A, loanId, periodId, amount }));
const status = async (loanId: string) =>
  (
    await asA((tx) =>
      tx
        .select({ s: employeeLoans.status })
        .from(employeeLoans)
        .where(eq(employeeLoans.id, loanId)),
    )
  )[0]?.s;

beforeAll(async () => {
  await db
    .insert(users)
    .values(
      ["loan-owner-a", "loan-owner-b"].map((id) => ({ id, name: id, email: `${id}@exemple.test` })),
    );
  A = await withUser(db, "loan-owner-a", (tx) =>
    createTenantWithOwner(tx, "loan-owner-a", fake("A")),
  );
  B = await withUser(db, "loan-owner-b", (tx) =>
    createTenantWithOwner(tx, "loan-owner-b", fake("B")),
  );
  empA = (await asA((tx) => tx.insert(employees).values(employee(A)).returning()))[0]?.id ?? "";
  empB = (await asB((tx) => tx.insert(employees).values(employee(B)).returning()))[0]?.id ?? "";
  for (const m of [1, 2, 3, 4]) periods[`v${m}`] = await period(m, "validated");
  periods.open = await period(5, "open");
});

afterAll(async () => {
  await db.$client.end();
});

describe("prêts : cycle de vie imposé par la base", () => {
  it("remboursements sur des mois validés, solde automatique au dernier franc", async () => {
    const loan = await newLoan();
    await repay(loan, periods.v1 ?? "", 30_000);
    await repay(loan, periods.v2 ?? "", 30_000);
    expect(await status(loan)).toBe("active");
    await repay(loan, periods.v3 ?? "", 30_000);
    expect(await status(loan)).toBe("settled");
    expect(await pgError(repay(loan, periods.v4 ?? "", 1))).toMatch(/prêt settled/);
  });

  it("refuse un remboursement supérieur au reste dû, en double ou hors paie validée", async () => {
    const loan = await newLoan(50_000, 30_000);
    await repay(loan, periods.v1 ?? "", 30_000);
    expect(await pgError(repay(loan, periods.v2 ?? "", 20_001))).toMatch(/reste dû \(20000 FCFA\)/);
    expect(await pgError(repay(loan, periods.v1 ?? "", 1))).toMatch(/duplicate key/);
    expect(await pgError(repay(loan, periods.open ?? "", 1))).toMatch(/hors d'une paie validée/);
  });

  it("deux remboursements simultanés ne dépassent jamais le montant prêté", async () => {
    const loan = await newLoan(40_000, 30_000);
    const results = await Promise.allSettled([
      repay(loan, periods.v1 ?? "", 30_000),
      repay(loan, periods.v2 ?? "", 30_000),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const [total] = await asA((tx) =>
      tx
        .select({ s: sql<number>`sum(${loanRepayments.amount})::int` })
        .from(loanRepayments)
        .where(eq(loanRepayments.loanId, loan)),
    );
    expect(total?.s).toBe(30_000);
  });

  it("montant, salarié et départ immuables ; mensualité modifiable tant qu'il est en cours", async () => {
    const loan = await newLoan();
    const update = (values: Partial<typeof employeeLoans.$inferInsert>) =>
      asA((tx) => tx.update(employeeLoans).set(values).where(eq(employeeLoans.id, loan)));
    expect(await pgError(update({ principal: 1 }))).toMatch(/seuls la mensualité/);
    expect(await pgError(update({ startMonth: 7 }))).toMatch(/seuls la mensualité/);
    await update({ installment: 45_000 });
    expect(await pgError(update({ installment: 90_001 }))).toMatch(/installment_chk/);
    expect(await pgError(update({ status: "settled" }))).toMatch(/non soldé/);
    expect(await pgError(update({ status: "cancelled" }))).toMatch(/cancel_chk/);
    await update({ status: "cancelled", cancelledAt: new Date(), cancelledBy: "loan-owner-a" });
    expect(await pgError(update({ installment: 10_000 }))).toMatch(/figé/);
    expect(await pgError(update({ status: "active" }))).toMatch(/figé/);
    expect(await pgError(repay(loan, periods.v4 ?? "", 1))).toMatch(/prêt cancelled/);
  });

  it("ni suppression de prêt, ni modification ou suppression de remboursement", async () => {
    const loan = await newLoan();
    await repay(loan, periods.v4 ?? "", 10_000);
    expect(
      await pgError(asA((tx) => tx.delete(employeeLoans).where(eq(employeeLoans.id, loan)))),
    ).toMatch(/permission denied/);
    expect(
      await pgError(
        asA((tx) =>
          tx.update(loanRepayments).set({ amount: 1 }).where(eq(loanRepayments.loanId, loan)),
        ),
      ),
    ).toMatch(/permission denied/);
    expect(
      await pgError(asA((tx) => tx.delete(loanRepayments).where(eq(loanRepayments.loanId, loan)))),
    ).toMatch(/permission denied/);
  });
});

describe("prêts : isolation entre entreprises", () => {
  it("B ne voit pas les prêts de A et ne peut ni prêter à un salarié de A ni rembourser", async () => {
    const loan = await newLoan();
    expect(await asB((tx) => tx.select().from(employeeLoans))).toEqual([]);
    expect(await asB((tx) => tx.select().from(loanRepayments))).toEqual([]);
    // Prêt de B pour un salarié de A : refusé par la clé étrangère composite.
    expect(
      await pgError(
        asB((tx) =>
          tx.insert(employeeLoans).values({
            tenantId: B,
            employeeId: empA,
            kind: "advance",
            label: "x",
            principal: 1000,
            installment: 1000,
            grantedOn: "2026-01-01",
            startYear: 2026,
            startMonth: 1,
            createdBy: "loan-owner-b",
          }),
        ),
      ),
    ).toMatch(/same_tenant_employee_fk|violates/);
    expect(
      await pgError(
        asB((tx) =>
          tx
            .insert(loanRepayments)
            .values({ tenantId: B, loanId: loan, periodId: periods.v1 ?? "", amount: 1 }),
        ),
      ),
    ).not.toBe("aucune erreur");
    expect(empB).not.toBe("");
  });
});
