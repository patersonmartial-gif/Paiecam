import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PDFParse } from "pdf-parse";
import {
  createDb,
  createTenantWithOwner,
  schema,
  sql,
  withTenant,
  withUser,
  type NewTenant,
} from "@paiecam/db";
import { loadTestRules, testDatabaseUrl } from "@paiecam/db/testing";
import { loadRuleFile } from "@paiecam/paie-engine/rules";
import { parseKeyring } from "@paiecam/security";
import type { RequestContext } from "@/server/authz/action";
import { makeExportEmployeeData } from "@/server/features/data-rights";
import { makeCreateEmployee, makeUpdateBankDetails } from "@/server/features/employees";
import { makeCalculatePeriod, makeOpenPeriod } from "@/server/features/payroll";

const db = createDb(testDatabaseUrl());
const keyring = parseKeyring(`v1:${Buffer.alloc(32, 12).toString("base64")}`);
const exportData = makeExportEmployeeData(db, keyring);
const U = { owner: "dr-owner", accountant: "dr-accountant", ownerB: "dr-owner-b" };
let A = "";
let B = "";
let emp = "";
const ctx = (userId: string, tenantId = A): RequestContext => ({
  user: { id: userId, twoFactorEnabled: true },
  tenantId,
  ip: null,
  userAgent: null,
});
const ok = <T>(r: { ok: true; data: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.data;
};

beforeAll(async () => {
  await loadTestRules(
    loadRuleFile(
      new URL("../../../packages/paie-engine/rules/cm-2026.draft.json", import.meta.url).pathname,
    ),
  );
  await db
    .insert(schema.users)
    .values(Object.values(U).map((id) => ({ id, name: id, email: `${id}@exemple.test` })));
  const t = (n: string): NewTenant => ({
    legalName: `École fictive ${n}`,
    niu: `S0000000000${n}`,
    cnpsEmployerNumber: `000-000000-${n}`,
    regime: "enseignement_prive",
    workAccidentRate: 175,
    commune: "Buea",
  });
  A = await withUser(db, U.owner, (tx) => createTenantWithOwner(tx, U.owner, t("A")));
  B = await withUser(db, U.ownerB, (tx) => createTenantWithOwner(tx, U.ownerB, t("B")));
  await withTenant(db, { tenantId: A, userId: U.owner }, (tx) =>
    tx.insert(schema.memberships).values({ tenantId: A, userId: U.accountant, role: "accountant" }),
  );
  emp = ok(
    await makeCreateEmployee(db, keyring)(ctx(U.owner), {
      matricule: "S-1",
      lastName: "FICTIVE",
      firstNames: "Nadia",
      birthDate: "1985-09-09",
      cnpsNumber: "555666777",
      hireDate: "2024-01-15",
      contractType: "cdi",
      endDate: "",
      jobTitle: "Enseignante",
      category: "6",
      echelon: "B",
      baseSalary: "320000",
      maritalStatus: "married",
      childrenCount: "3",
      paymentMethod: "bank_transfer",
    }),
  ).id;
  ok(
    await makeUpdateBankDetails(db, { keyring, verifyPassword: async () => true })(ctx(U.owner), {
      id: emp,
      password: "x",
      bank: { iban: "CM2110002000300277976315008" },
    }),
  );
  const periodId = ok(await makeOpenPeriod(db)(ctx(U.owner), { year: 2026, month: 2 })).periodId;
  ok(await makeCalculatePeriod(db, { allowDraftRules: true })(ctx(U.owner), { periodId }));
});

afterAll(async () => {
  await db.$client.end();
});

describe("droit d'accès d'un salarié", () => {
  it("JSON : fiche, coordonnées en clair, bulletins avec lignes, historique", async () => {
    const res = ok(await exportData(ctx(U.owner), { employeeId: emp, format: "json" }));
    const data = JSON.parse(res.file.toString("utf8"));
    expect(res.filename).toMatch(/^donnees-salarie-S-1-\d{4}-\d{2}-\d{2}\.json$/);
    expect(data.employee).toMatchObject({
      matricule: "S-1",
      cnpsNumber: "555666777",
      childrenCount: 3,
    });
    expect(data.paymentDetails.iban).toBe("CM2110002000300277976315008");
    expect(data.payslips).toHaveLength(1);
    expect(data.payslips[0].lines.some((l: { code: string }) => l.code === "irpp")).toBe(true);
    expect(data.auditTrail.map((a: { action: string }) => a.action)).toEqual(
      expect.arrayContaining(["employees.create", "employees.update_bank_details"]),
    );
    expect(data.controller.legalName).toBe("École fictive A");
  });

  it("PDF lisible, et chaque export est audité", async () => {
    const res = ok(await exportData(ctx(U.owner), { employeeId: emp, format: "pdf" }));
    const p = new PDFParse({ data: new Uint8Array(res.file) });
    const text = (await p.getText()).text.replace(/\s+/g, " ");
    await p.destroy();
    for (const s of [
      "Données personnelles — FICTIVE Nadia",
      "École fictive A",
      "555666777",
      "CM2110002000300277976315008",
      "2026-02",
    ])
      expect(text, s).toContain(s);
    const rows = await withTenant(db, { tenantId: A, userId: U.owner }, (tx) =>
      tx.execute(sql`select 1 from audit_log where action = 'employees.data_export'`),
    );
    expect(rows.length).toBe(2);
  });

  it("le comptable ne peut pas exporter ; B ne peut pas exporter un salarié de A", async () => {
    expect(await exportData(ctx(U.accountant), { employeeId: emp, format: "json" })).toEqual({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(await exportData(ctx(U.ownerB, B), { employeeId: emp, format: "json" })).toEqual({
      ok: false,
      error: { code: "RULE", reason: "not_found" },
    });
  });
});
