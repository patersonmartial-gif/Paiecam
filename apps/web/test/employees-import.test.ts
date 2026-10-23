import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDb,
  createTenantWithOwner,
  schema,
  withTenant,
  withUser,
  type NewTenant,
} from "@paiecam/db";
import { testDatabaseUrl } from "@paiecam/db/testing";
import { parseKeyring } from "@paiecam/security";
import type { RequestContext } from "@/server/authz/action";
import { makeCreateEmployee } from "@/server/features/employees";
import { makeImportEmployees } from "@/server/features/employees-import";

const db = createDb(testDatabaseUrl());
const keyring = parseKeyring(`v1:${Buffer.alloc(32, 5).toString("base64")}`);
const importEmployees = makeImportEmployees(db, keyring);
const create = makeCreateEmployee(db, keyring);

const fake = (n: string): NewTenant => ({
  legalName: `Import fictif ${n}`,
  niu: `X0000000000${n}`,
  cnpsEmployerNumber: `000-000000-${n}`,
  regime: "general",
  workAccidentRate: 175,
  commune: "Limbé 1er",
});
let A = "";
const owner = "imp-owner";
const accountant = "imp-accountant";
const ctx = (userId: string): RequestContext => ({
  user: { id: userId, twoFactorEnabled: true },
  tenantId: A,
  ip: "203.0.113.40",
  userAgent: "vitest",
});

const row = (line: number, over: Record<string, string> = {}) => ({
  line,
  data: {
    matricule: `I-${line}`,
    lastName: "Fictif",
    firstNames: `Salarié ${line}`,
    birthDate: "1990-01-01",
    cnpsNumber: `55500${line}000`,
    hireDate: "2024-01-01",
    contractType: "cdi",
    endDate: "",
    jobTitle: "Agent",
    category: "3",
    echelon: "A",
    baseSalary: "120000",
    maritalStatus: "single",
    childrenCount: "0",
    paymentMethod: "cash",
    ...over,
  },
});

const count = () =>
  withTenant(
    db,
    { tenantId: A, userId: owner },
    async (tx) => (await tx.select().from(schema.employees)).length,
  );

beforeAll(async () => {
  await db
    .insert(schema.users)
    .values([owner, accountant].map((id) => ({ id, name: id, email: `${id}@exemple.test` })));
  A = await withUser(db, owner, (tx) => createTenantWithOwner(tx, owner, fake("A")));
  await withTenant(db, { tenantId: A, userId: owner }, (tx) =>
    tx.insert(schema.memberships).values({ tenantId: A, userId: accountant, role: "accountant" }),
  );
  await create(ctx(owner), { ...row(99).data, matricule: "EXISTANT", cnpsNumber: "777777777" });
});

afterAll(async () => {
  await db.$client.end();
});

describe("import de salariés", () => {
  it("l'aperçu signale chaque erreur par ligne et n'importe rien", async () => {
    const res = await importEmployees(ctx(owner), {
      commit: false,
      rows: [
        row(2),
        row(3, { baseSalary: "abc", birthDate: "" }),
        row(4, { matricule: "I-2" }),
        row(5, { cnpsNumber: "555 002 000" }),
        row(6, { matricule: "EXISTANT" }),
        row(7, { cnpsNumber: "777-777-777" }),
      ],
    });
    expect(res.ok && res.data).toEqual({
      total: 6,
      valid: 1,
      imported: 0,
      errors: [
        { line: 3, fields: ["birthDate", "baseSalary"] },
        { line: 4, fields: ["matricule"], reason: "duplicate_matricule" },
        { line: 5, fields: ["cnpsNumber"], reason: "duplicate_cnps" },
        { line: 6, fields: ["matricule"], reason: "existing_matricule" },
        { line: 7, fields: ["cnpsNumber"], reason: "existing_cnps" },
      ],
    });
    expect(await count()).toBe(1);
  });

  it("tout ou rien : une seule ligne en erreur bloque toute la confirmation", async () => {
    const res = await importEmployees(ctx(owner), {
      commit: true,
      rows: [row(2), row(3, { lastName: "" })],
    });
    expect(res.ok && res.data.imported).toBe(0);
    expect(await count()).toBe(1);
  });

  it("importe toutes les lignes valides, n° CNPS chiffrés", async () => {
    const res = await importEmployees(ctx(owner), {
      commit: true,
      rows: [row(2), row(3), row(4, { cnpsNumber: "" })],
    });
    expect(res.ok && res.data).toEqual({ total: 3, valid: 3, imported: 3, errors: [] });
    const rows = await withTenant(db, { tenantId: A, userId: owner }, (tx) =>
      tx.select().from(schema.employees),
    );
    expect(rows).toHaveLength(4);
    expect(JSON.stringify(rows)).not.toContain("555002000");
    expect(rows.find((r) => r.matricule === "I-2")?.cnpsNumberLast4).toBe("2000");
  });

  it("un second import du même fichier est refusé (doublons)", async () => {
    const res = await importEmployees(ctx(owner), { commit: true, rows: [row(2)] });
    expect(res.ok && res.data.errors[0]?.reason).toBe("existing_matricule");
  });

  it("le comptable ne peut pas importer ; la taille est bornée", async () => {
    expect(await importEmployees(ctx(accountant), { commit: false, rows: [row(2)] })).toEqual({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    const tooMany = Array.from({ length: 501 }, (_, i) => row(i + 2));
    const res = await importEmployees(ctx(owner), { commit: false, rows: tooMany });
    expect(res.ok === false && res.error.code).toBe("INVALID_INPUT");
  });
});
