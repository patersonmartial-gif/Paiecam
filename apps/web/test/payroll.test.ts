import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDb,
  createTenantWithOwner,
  schema,
  withTenant,
  withUser,
  type NewTenant,
} from "@paiecam/db";
import { loadTestRules, testDatabaseUrl, validateAllTestRules } from "@paiecam/db/testing";
import { loadRuleFile } from "@paiecam/paie-engine/rules";
import { parseKeyring } from "@paiecam/security";
import type { RequestContext } from "@/server/authz/action";
import { makeCreateEmployee } from "@/server/features/employees";
import {
  makeCalculatePeriod,
  makeGetPayslip,
  makeGetPeriod,
  makeOpenPeriod,
  makeReopenPeriod,
  makeSaveVariables,
  makeValidatePeriod,
} from "@/server/features/payroll";

const db = createDb(testDatabaseUrl());
const keyring = parseKeyring(`v1:${Buffer.alloc(32, 9).toString("base64")}`);
const PASSWORD = "mot-de-passe-fictif";
const validated: string[] = [];

const createEmployee = makeCreateEmployee(db, keyring);
const openPeriod = makeOpenPeriod(db);
const getPeriod = makeGetPeriod(db);
const save = makeSaveVariables(db);
const calcDraftAllowed = makeCalculatePeriod(db, { allowDraftRules: true });
const calcStrict = makeCalculatePeriod(db, { allowDraftRules: false });
const reopen = makeReopenPeriod(db);
const validate = makeValidatePeriod(db, {
  verifyPassword: async (_u, pw) => pw === PASSWORD,
  onValidated: async (periodId) => void validated.push(periodId),
});
const getPayslip = makeGetPayslip(db);

const fake = (n: string): NewTenant => ({
  legalName: `Boutique fictive ${n}`,
  niu: `B0000000000${n}`,
  cnpsEmployerNumber: `000-000000-${n}`,
  regime: "general",
  workAccidentRate: 175,
  commune: "Bertoua 1er",
});
const U = { owner: "pr-owner", accountant: "pr-accountant", ownerB: "pr-owner-b" };
let A = "";
let B = "";
const ctx = (userId: string, tenantId = A): RequestContext => ({
  user: { id: userId, twoFactorEnabled: true },
  tenantId,
  ip: "203.0.113.50",
  userAgent: "vitest",
});
const ok = <T>(r: { ok: true; data: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.data;
};
const employee = (over: Record<string, string>) => ({
  matricule: "P-1",
  lastName: "Fictif",
  firstNames: "Un",
  birthDate: "1990-01-01",
  cnpsNumber: "",
  hireDate: "2024-01-15",
  contractType: "cdi",
  endDate: "",
  jobTitle: "Vendeur",
  category: "4",
  echelon: "B",
  baseSalary: "400000",
  maritalStatus: "single",
  childrenCount: "0",
  paymentMethod: "cash",
  ...over,
});

let e1 = "";
let e2 = "";
let march = "";

beforeAll(async () => {
  await loadTestRules(
    loadRuleFile(
      new URL("../../../packages/paie-engine/rules/cm-2026.draft.json", import.meta.url).pathname,
    ),
  );
  await db
    .insert(schema.users)
    .values(Object.values(U).map((id) => ({ id, name: id, email: `${id}@exemple.test` })));
  A = await withUser(db, U.owner, (tx) => createTenantWithOwner(tx, U.owner, fake("A")));
  B = await withUser(db, U.ownerB, (tx) => createTenantWithOwner(tx, U.ownerB, fake("B")));
  await withTenant(db, { tenantId: A, userId: U.owner }, (tx) =>
    tx.insert(schema.memberships).values({ tenantId: A, userId: U.accountant, role: "accountant" }),
  );
  e1 = ok(await createEmployee(ctx(U.owner), employee({ cnpsNumber: "111222333" }))).id;
  e2 = ok(
    await createEmployee(
      ctx(U.owner),
      employee({
        matricule: "P-2",
        firstNames: "Deux",
        baseSalary: "310000",
        hireDate: "2026-03-16",
      }),
    ),
  ).id;
  // Embauché après mars : absent de la grille de mars.
  ok(
    await createEmployee(
      ctx(U.owner),
      employee({ matricule: "P-3", firstNames: "Trois", hireDate: "2026-04-02" }),
    ),
  );
});

afterAll(async () => {
  await db.$client.end();
});

describe("ouverture et saisie", () => {
  it("ouvre mars une seule fois, avec les rubriques par défaut", async () => {
    march = ok(await openPeriod(ctx(U.owner), { year: 2026, month: 3 })).periodId;
    expect(await openPeriod(ctx(U.owner), { year: 2026, month: 3 })).toMatchObject({
      ok: false,
      error: { code: "CONFLICT" },
    });
    const grid = ok(await getPeriod(ctx(U.accountant), { periodId: march }));
    // Tri par nom puis prénom : « Fictif Deux » avant « Fictif Un ».
    expect(grid.employees.map((e) => e.matricule)).toEqual(["P-2", "P-1"]);
    expect(grid.items.map((i) => i.code)).toContain("prime_rendement");
    expect(grid.period).toMatchObject({ start: "2026-03-01", end: "2026-03-31", status: "open" });
  });

  it("enregistre les variables, en refusant salariés, rubriques et catégories inconnus", async () => {
    expect(
      ok(
        await save(ctx(U.owner), {
          periodId: march,
          entries: [
            { employeeId: e2, key: "item:prime_rendement", value: 20_000 },
            { employeeId: e2, key: "item:avantage_logement", value: 30_000 },
            { employeeId: e2, key: "item:indemnite_transport", value: 15_000 },
            { employeeId: e2, key: "item:avance", value: 10_000 },
            { employeeId: e2, key: "hs:hs_20", value: 800 },
            { employeeId: e1, key: "item:prime_anciennete", value: 5_000 },
          ],
        }),
      ),
    ).toEqual({ saved: 6, cleared: 0 });
    expect(
      ok(
        await save(ctx(U.owner), {
          periodId: march,
          entries: [{ employeeId: e1, key: "item:prime_anciennete", value: 0 }],
        }),
      ),
    ).toEqual({
      saved: 0,
      cleared: 1,
    });
    const rule = (reason: string) => ({ ok: false, error: { code: "RULE", reason } });
    expect(
      await save(ctx(U.owner), {
        periodId: march,
        entries: [{ employeeId: e1, key: "item:inexistante", value: 1 }],
      }),
    ).toEqual(rule("unknown_item"));
    expect(
      await save(ctx(U.owner), {
        periodId: march,
        entries: [{ employeeId: e1, key: "hs:hs_99", value: 1 }],
      }),
    ).toEqual(rule("unknown_overtime"));
    expect(await save(ctx(U.accountant), { periodId: march, entries: [] })).toEqual({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });

  it("anti-IDOR : B ne lit ni ne modifie le mois de A", async () => {
    const notFound = { ok: false, error: { code: "RULE", reason: "not_found" } };
    expect(await getPeriod(ctx(U.ownerB, B), { periodId: march })).toEqual(notFound);
    expect(await save(ctx(U.ownerB, B), { periodId: march, entries: [] })).toEqual(notFound);
    expect(await calcDraftAllowed(ctx(U.ownerB, B), { periodId: march })).toEqual(notFound);
  });
});

describe("calcul", () => {
  it("refuse de calculer avec des règles en brouillon si ce n'est pas autorisé", async () => {
    expect(await calcStrict(ctx(U.owner), { periodId: march })).toEqual({
      ok: false,
      error: { code: "RULE", reason: "draft_rules" },
    });
  });

  it("calcule des bulletins provisoires, identiques aux cas de contrôle du moteur", async () => {
    expect(ok(await calcDraftAllowed(ctx(U.owner), { periodId: march }))).toMatchObject({
      payslips: 2,
      provisional: 2,
    });
    const grid = ok(await getPeriod(ctx(U.owner), { periodId: march }));
    expect(grid.period.status).toBe("calculated");
    const net = Object.fromEntries(grid.payslips.map((p) => [p.employeeId, p.netPay]));
    expect(net[e1]).toBe(345_015);
    expect(net[e2]).toBe(172_998);
    const slip2 = grid.payslips.find((p) => p.employeeId === e2);
    expect(slip2?.status).toBe("provisional");
    expect(slip2?.warnings).toEqual(
      expect.arrayContaining(["partial_month", "missing_cnps_number"]),
    );
    const detail = ok(await getPayslip(ctx(U.accountant), { payslipId: slip2?.id ?? "" }));
    expect(detail.lines.map((l) => l.code)).toContain("overtime.hs_20");
    expect(detail.slip.employeeSnapshot).toMatchObject({ matricule: "P-2", cnpsNumberLast4: null });
    expect(JSON.stringify(detail)).not.toContain("111222333");
  });

  it("refuse la validation de bulletins provisoires ou avec un mauvais mot de passe", async () => {
    expect(await validate(ctx(U.owner), { periodId: march, password: "faux" })).toEqual({
      ok: false,
      error: { code: "RULE", reason: "bad_password" },
    });
    expect(await validate(ctx(U.owner), { periodId: march, password: PASSWORD })).toEqual({
      ok: false,
      error: { code: "RULE", reason: "provisional_payslips" },
    });
  });

  it("la réouverture supprime les bulletins et rouvre la saisie", async () => {
    ok(await reopen(ctx(U.owner), { periodId: march }));
    const grid = ok(await getPeriod(ctx(U.owner), { periodId: march }));
    expect(grid.period.status).toBe("open");
    expect(grid.payslips).toEqual([]);
    expect(await reopen(ctx(U.owner), { periodId: march })).toEqual({
      ok: false,
      error: { code: "RULE", reason: "period_not_calculated" },
    });
  });
});

describe("validation avec des règles validées", () => {
  it("bulletins définitifs, validation, puis plus aucune modification", async () => {
    await validateAllTestRules();
    expect(ok(await calcStrict(ctx(U.owner), { periodId: march }))).toMatchObject({
      payslips: 2,
      provisional: 0,
    });
    expect(await validate(ctx(U.accountant), { periodId: march, password: PASSWORD })).toEqual({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(ok(await validate(ctx(U.owner), { periodId: march, password: PASSWORD }))).toEqual({
      periodId: march,
    });
    expect(validated).toEqual([march]);

    const grid = ok(await getPeriod(ctx(U.owner), { periodId: march }));
    expect(grid.period).toMatchObject({ status: "validated", validatedBy: U.owner });
    const rule = (reason: string) => ({ ok: false, error: { code: "RULE", reason } });
    expect(await save(ctx(U.owner), { periodId: march, entries: [] })).toEqual(
      rule("period_not_open"),
    );
    expect(await calcStrict(ctx(U.owner), { periodId: march })).toEqual(rule("period_frozen"));
    expect(await reopen(ctx(U.owner), { periodId: march })).toEqual(rule("period_not_calculated"));
  });

  it("signale une forte variation du net par rapport au mois précédent", async () => {
    const april = ok(await openPeriod(ctx(U.owner), { year: 2026, month: 4 })).periodId;
    ok(
      await save(ctx(U.owner), {
        periodId: april,
        entries: [{ employeeId: e1, key: "item:prime_rendement", value: 200_000 }],
      }),
    );
    ok(await calcStrict(ctx(U.owner), { periodId: april }));
    const grid = ok(await getPeriod(ctx(U.owner), { periodId: april }));
    expect(grid.payslips.find((p) => p.employeeId === e1)?.warnings).toContain("net_variation");
    expect(grid.employees.map((e) => e.matricule)).toEqual(["P-2", "P-3", "P-1"]);
  });
});
