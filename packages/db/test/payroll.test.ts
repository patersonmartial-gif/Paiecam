import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { createTenantWithOwner, withTenant, withUser, type NewTenant, type Tx } from "../src";
import {
  declarations,
  documents,
  employees,
  payPeriods,
  payslipLines,
  payslips,
  payVariables,
  users,
} from "../src/schema";
import { db } from "./db";

const fake = (n: string): NewTenant => ({
  legalName: `Paie fictive ${n}`,
  niu: `Q0000000000${n}`,
  cnpsEmployerNumber: `000-000000-${n}`,
  regime: "general",
  workAccidentRate: 175,
  commune: "Ebolowa 1er",
});
let A = "";
let B = "";
const asA = <T>(fn: (tx: Tx) => Promise<T>) =>
  withTenant(db, { tenantId: A, userId: "pay-owner-a" }, fn);
const asB = <T>(fn: (tx: Tx) => Promise<T>) =>
  withTenant(db, { tenantId: B, userId: "pay-owner-b" }, fn);

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
  matricule: `M-${Math.random().toString(36).slice(2, 8)}`,
  lastName: "Fictif",
  firstNames: "Test",
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

async function newPeriod(month: number) {
  const [p] = await asA((tx) =>
    tx.insert(payPeriods).values({ tenantId: A, year: 2026, month }).returning(),
  );
  if (!p) throw new Error("période non créée");
  return p.id;
}
const setStatus = (id: string, values: Partial<typeof payPeriods.$inferInsert>) =>
  asA((tx) => tx.update(payPeriods).set(values).where(eq(payPeriods.id, id)));
const payslip = (periodId: string, status: "provisional" | "final" = "final") =>
  asA((tx) =>
    tx
      .insert(payslips)
      .values({
        tenantId: A,
        periodId,
        employeeId: empA,
        status,
        input: {},
        employeeSnapshot: {},
        rulesUsed: [],
        totals: {},
        warnings: [],
        gross: 150_000,
        netPay: 130_000,
        employerCost: 175_000,
      })
      .returning(),
  );

let docCounter = 0;
/** Crée une déclaration « générée » (avec son document) pour la période. */
async function declaration(periodId: string, kind: "cnps" | "dgi" | "dipe") {
  const code = `DECL-${++docCounter}-${kind}`;
  const [doc] = await asA((tx) =>
    tx
      .insert(documents)
      .values({
        tenantId: A,
        kind: `declaration_${kind}`,
        language: "fr",
        issuerName: "x",
        periodYear: 2026,
        periodMonth: 1,
        storageKey: `k-${code}`,
        sizeBytes: 1,
        sha256: "s",
        signature: "g",
        verificationCode: code,
      })
      .returning(),
  );
  const [d] = await asA((tx) =>
    tx
      .insert(declarations)
      .values({
        tenantId: A,
        periodId,
        kind,
        amountDue: 1000,
        dueDate: "2026-04-15",
        documentId: doc?.id ?? "",
        updatedBy: "x",
      })
      .returning(),
  );
  return d?.id ?? "";
}

beforeAll(async () => {
  await db.insert(users).values([
    { id: "pay-owner-a", name: "a", email: "pay-owner-a@exemple.test" },
    { id: "pay-owner-b", name: "b", email: "pay-owner-b@exemple.test" },
  ]);
  A = await withUser(db, "pay-owner-a", (tx) =>
    createTenantWithOwner(tx, "pay-owner-a", fake("A")),
  );
  B = await withUser(db, "pay-owner-b", (tx) =>
    createTenantWithOwner(tx, "pay-owner-b", fake("B")),
  );
  const ea = employee(A);
  const eb = employee(B);
  empA = ea.id;
  empB = eb.id;
  await asA((tx) => tx.insert(employees).values(ea));
  await asB((tx) => tx.insert(employees).values(eb));
});

afterAll(async () => {
  await db.$client.end();
});

describe("états d'une période", () => {
  it("open ⇄ calculated → validated → locked, sans saut ni retour", async () => {
    const id = await newPeriod(1);
    expect(
      await pgError(
        setStatus(id, { status: "validated", validatedBy: "x", validatedAt: new Date() }),
      ),
    ).toMatch(/open → validated/);
    expect(await pgError(setStatus(id, { status: "calculated" }))).toBe("aucune erreur");
    expect(await pgError(setStatus(id, { status: "open" }))).toBe("aucune erreur");
    await setStatus(id, { status: "calculated" });
    expect(await pgError(setStatus(id, { status: "validated" }))).toMatch(/sans auteur/);
    await payslip(id, "provisional");
    expect(
      await pgError(
        setStatus(id, { status: "validated", validatedBy: "x", validatedAt: new Date() }),
      ),
    ).toMatch(/provisoires/);
  });

  it("une période validée est figée et ne revient jamais en arrière", async () => {
    const id = await newPeriod(2);
    await setStatus(id, { status: "calculated" });
    await payslip(id);
    expect(
      await pgError(
        setStatus(id, { status: "validated", validatedBy: "x", validatedAt: new Date() }),
      ),
    ).toBe("aucune erreur");
    expect(await pgError(setStatus(id, { status: "open" }))).toMatch(/validated → open/);
    expect(await pgError(setStatus(id, { validatedBy: "autre" }))).toMatch(/figée/);
    // Verrouillage refusé tant que les trois déclarations ne sont pas déposées.
    expect(await pgError(setStatus(id, { status: "locked", lockedAt: new Date() }))).toMatch(
      /déclarations non déposées/,
    );
    for (const kind of ["cnps", "dgi", "dipe"] as const) {
      const d = await declaration(id, kind);
      await asA((tx) =>
        tx
          .update(declarations)
          .set({ status: "filed", filedAt: "2026-03-10", filingReference: `REF-${kind}` })
          .where(eq(declarations.id, d)),
      );
    }
    expect(await pgError(setStatus(id, { status: "locked", lockedAt: new Date() }))).toBe(
      "aucune erreur",
    );
    expect(await pgError(setStatus(id, { status: "validated" }))).toMatch(/locked → validated/);
    expect(await pgError(asA((tx) => tx.delete(payPeriods).where(eq(payPeriods.id, id))))).toMatch(
      // Le rôle applicatif n'a pas le droit DELETE ; le trigger protège en plus le propriétaire.
      /permission denied|ne se supprime pas/,
    );
  });

  it("un mois n'existe qu'une fois par entreprise", async () => {
    expect(await pgError(newPeriod(2))).toMatch(/pay_periods_tenant_month_key/);
  });
});

describe("variables et bulletins figés", () => {
  it("les variables ne se saisissent que sur une période ouverte", async () => {
    const id = await newPeriod(3);
    const v = {
      tenantId: A,
      periodId: id,
      employeeId: empA,
      key: "item:prime",
      value: 10_000,
      updatedBy: "pay-owner-a",
    };
    expect(await pgError(asA((tx) => tx.insert(payVariables).values(v)))).toBe("aucune erreur");
    await setStatus(id, { status: "calculated" });
    expect(await pgError(asA((tx) => tx.update(payVariables).set({ value: 1 })))).toMatch(
      /variables figées/,
    );
    expect(
      await pgError(asA((tx) => tx.insert(payVariables).values({ ...v, key: "absence" }))),
    ).toMatch(/variables figées/);
  });

  it("refuse une clé de variable inconnue ou une valeur négative", async () => {
    const id = await newPeriod(4);
    const v = { tenantId: A, periodId: id, employeeId: empA, updatedBy: "pay-owner-a" };
    expect(
      await pgError(
        asA((tx) => tx.insert(payVariables).values({ ...v, key: "salaire", value: 1 })),
      ),
    ).toMatch(/pay_variables_key_chk/);
    expect(
      await pgError(
        asA((tx) => tx.insert(payVariables).values({ ...v, key: "absence", value: -1 })),
      ),
    ).toMatch(/pay_variables_value_chk/);
  });

  it("après validation, bulletins et lignes ne bougent plus", async () => {
    const id = await newPeriod(5);
    await setStatus(id, { status: "calculated" });
    const [ps] = await payslip(id);
    await asA((tx) =>
      tx.insert(payslipLines).values({
        tenantId: A,
        payslipId: ps?.id ?? "",
        position: 1,
        code: "base",
        label: "Base",
        section: "earning",
        amount: 150_000,
        explanation: "x",
      }),
    );
    await setStatus(id, { status: "validated", validatedBy: "x", validatedAt: new Date() });
    expect(
      await pgError(
        asA((tx) => tx.update(payslips).set({ netPay: 1 }).where(eq(payslips.periodId, id))),
      ),
    ).toMatch(/bulletins figés/);
    expect(
      await pgError(asA((tx) => tx.delete(payslips).where(eq(payslips.periodId, id)))),
    ).toMatch(/bulletins figés/);
    expect(await pgError(asA((tx) => tx.update(payslipLines).set({ amount: 1 })))).toMatch(
      /bulletins figés/,
    );
  });
});

describe("isolation", () => {
  it("impossible de rattacher le salarié d'une autre entreprise", async () => {
    const id = await newPeriod(6);
    expect(
      await pgError(
        asA((tx) =>
          tx.insert(payVariables).values({
            tenantId: A,
            periodId: id,
            employeeId: empB,
            key: "absence",
            value: 1,
            updatedBy: "x",
          }),
        ),
      ),
    ).toMatch(/pay_variables_same_tenant_employee_fk/);
  });

  it("B ne voit aucune période ni aucun bulletin de A", async () => {
    expect(await asB((tx) => tx.select().from(payPeriods))).toHaveLength(0);
    expect(await asB((tx) => tx.select().from(payslips))).toHaveLength(0);
  });
});

describe("documents", () => {
  it("un PDF émis ne se modifie ni ne se supprime ; sa vérification passe par son code", async () => {
    const id = await newPeriod(7);
    await setStatus(id, { status: "calculated" });
    const [ps] = await payslip(id);
    const code = "CODE-VERIF-1234";
    await asA((tx) =>
      tx.insert(documents).values({
        tenantId: A,
        payslipId: ps?.id ?? null,
        kind: "payslip_pdf",
        language: "fr",
        issuerName: "Paie fictive A",
        periodYear: 2026,
        periodMonth: 7,
        storageKey: `k-${code}`,
        sizeBytes: 10,
        sha256: "abc",
        signature: "sig",
        verificationCode: code,
      }),
    );
    expect(await pgError(asA((tx) => tx.update(documents).set({ sha256: "x" })))).toMatch(
      /permission denied/,
    );
    expect(await pgError(asA((tx) => tx.delete(documents)))).toMatch(/permission denied/);

    const lookup = (c: string) =>
      db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.document_code', ${c}, true)`);
        return tx
          .select({ issuer: documents.issuerName, month: documents.periodMonth })
          .from(documents);
      });
    expect(await lookup(code)).toEqual([{ issuer: "Paie fictive A", month: 7 }]);
    expect(await lookup("MAUVAIS-CODE")).toEqual([]);
    expect(await db.select().from(documents)).toHaveLength(0);
  });
});

describe("déclarations", () => {
  async function validatedPeriod(month: number) {
    const id = await newPeriod(month);
    await setStatus(id, { status: "calculated" });
    await setStatus(id, { status: "validated", validatedBy: "x", validatedAt: new Date() });
    return id;
  }
  const update = (id: string, values: Partial<typeof declarations.$inferInsert>) =>
    pgError(asA((tx) => tx.update(declarations).set(values).where(eq(declarations.id, id))));

  it("ne se créent que sur un mois validé, une par type", async () => {
    const open = await newPeriod(8);
    expect(await pgError(declaration(open, "cnps"))).toMatch(/le mois doit être validé/);
    const id = await validatedPeriod(9);
    await declaration(id, "cnps");
    expect(await pgError(declaration(id, "cnps"))).toMatch(/declarations_period_kind_key/);
  });

  it("générée → déposée → payée, jamais en arrière ; figée une fois déposée", async () => {
    const id = await validatedPeriod(10);
    const d = await declaration(id, "dgi");
    expect(await update(d, { status: "paid", paidAt: "2026-04-01" })).toMatch(/generated → paid/);
    expect(await update(d, { status: "filed" })).toMatch(/declarations_filed_chk/);
    expect(await update(d, { amountDue: 2000 })).toBe("aucune erreur");
    expect(
      await update(d, { status: "filed", filedAt: "2026-04-10", filingReference: "DGI-123" }),
    ).toBe("aucune erreur");
    expect(await update(d, { amountDue: 1 })).toMatch(/transition interdite|figés/);
    expect(await update(d, { status: "generated" })).toMatch(/filed → generated/);
    expect(
      await update(d, { status: "paid", paidAt: "2026-04-12", filingReference: "AUTRE" }),
    ).toMatch(/figées/);
    expect(
      await update(d, { status: "paid", paidAt: "2026-04-12", paymentReference: "VIR-9" }),
    ).toBe("aucune erreur");
    expect(await update(d, { paymentReference: "change" })).toMatch(/transition interdite/);
  });

  it("le rôle applicatif ne supprime pas une déclaration ; B ne voit rien", async () => {
    expect(await pgError(asA((tx) => tx.delete(declarations)))).toMatch(/permission denied/);
    expect(await asB((tx) => tx.select().from(declarations))).toHaveLength(0);
  });
});
