import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createDb,
  createTenantWithOwner,
  schema,
  sql,
  withTenant,
  withUser,
  type NewTenant,
} from "@paiecam/db";
import { testDatabaseUrl } from "@paiecam/db/testing";
import { parseKeyring } from "@paiecam/security";
import type { RequestContext } from "@/server/authz/action";
import {
  makeArchiveEmployee,
  makeCreateEmployee,
  makeGetEmployee,
  makeListEmployees,
  makeRevealSensitive,
  makeUpdateBankDetails,
  makeUpdateEmployee,
} from "@/server/features/employees";

const db = createDb(testDatabaseUrl());
const keyring = parseKeyring(`v1:${Buffer.alloc(32, 3).toString("base64")}`);
const GOOD_PASSWORD = "bon-mot-de-passe-fictif";
const verifyPassword = async (_: string, pw: string) => pw === GOOD_PASSWORD;

const create = makeCreateEmployee(db, keyring);
const update = makeUpdateEmployee(db, keyring);
const list = makeListEmployees(db);
const get = makeGetEmployee(db);
const archive = makeArchiveEmployee(db);
const updateBank = makeUpdateBankDetails(db, { keyring, verifyPassword });
const reveal = makeRevealSensitive(db, keyring);

const IBAN = "CM2110002000300277976315008";
const CNPS = "198765432";

const fake = (n: string): NewTenant => ({
  legalName: `Commerce fictif ${n}`,
  niu: `E0000000000${n}`,
  cnpsEmployerNumber: `000-000000-${n}`,
  regime: "general",
  workAccidentRate: 175,
  commune: "Kribi 1er",
});
const U = { ownerA: "emp-owner-a", accountantA: "emp-accountant-a", ownerB: "emp-owner-b" };
let A = "";
let B = "";

const ctx = (userId: string, tenantId: string): RequestContext => ({
  user: { id: userId, twoFactorEnabled: true },
  tenantId,
  ip: "203.0.113.30",
  userAgent: "vitest",
});

const employee = (over: Record<string, unknown> = {}) => ({
  matricule: "E-001",
  lastName: "Fictif",
  firstNames: "Jean",
  birthDate: "1990-05-01",
  cnpsNumber: CNPS,
  hireDate: "2024-01-15",
  contractType: "cdi",
  endDate: "",
  jobTitle: "Vendeur",
  category: "4",
  echelon: "B",
  baseSalary: "185000",
  maritalStatus: "married",
  childrenCount: "2",
  paymentMethod: "bank_transfer",
  ...over,
});

async function mustCreate(tenantId: string, userId: string, over: Record<string, unknown> = {}) {
  const res = await create(ctx(userId, tenantId), employee(over));
  if (!res.ok) throw new Error(JSON.stringify(res.error));
  return res.data.id;
}

/** Contenu brut des tables et du journal, vu par le propriétaire de l'entreprise. */
async function rawDump(tenantId: string, userId: string) {
  return withTenant(db, { tenantId, userId }, async (tx) =>
    JSON.stringify({
      e: await tx.select().from(schema.employees),
      b: await tx.select().from(schema.employeeBankDetails),
      a: await tx.select().from(schema.auditLog),
    }),
  );
}

let emp1 = "";

beforeAll(async () => {
  await db
    .insert(schema.users)
    .values(Object.values(U).map((id) => ({ id, name: id, email: `${id}@exemple.test` })));
  A = await withUser(db, U.ownerA, (tx) => createTenantWithOwner(tx, U.ownerA, fake("A")));
  B = await withUser(db, U.ownerB, (tx) => createTenantWithOwner(tx, U.ownerB, fake("B")));
  await withTenant(db, { tenantId: A, userId: U.ownerA }, (tx) =>
    tx
      .insert(schema.memberships)
      .values({ tenantId: A, userId: U.accountantA, role: "accountant" }),
  );
  emp1 = await mustCreate(A, U.ownerA);
});

afterAll(async () => {
  await db.$client.end();
});

describe("création", () => {
  it("chiffre le n° CNPS et ne le stocke nulle part en clair", async () => {
    const [row] = await withTenant(db, { tenantId: A, userId: U.ownerA }, (tx) =>
      tx.select().from(schema.employees),
    );
    expect(row?.cnpsNumberEnc).toMatch(/^v1\./);
    expect(row?.cnpsNumberIndex).toMatch(/^v1\./);
    expect(row?.cnpsNumberLast4).toBe("5432");
    expect(await rawDump(A, U.ownerA)).not.toContain(CNPS);
  });

  it("refuse un matricule en double", async () => {
    expect(await create(ctx(U.ownerA, A), employee({ cnpsNumber: "" }))).toEqual({
      ok: false,
      error: { code: "CONFLICT", constraint: "employees_tenant_matricule_key" },
    });
  });

  it("détecte un n° CNPS en double, même saisi autrement", async () => {
    expect(
      await create(ctx(U.ownerA, A), employee({ matricule: "E-002", cnpsNumber: "198-765 432" })),
    ).toEqual({
      ok: false,
      error: { code: "CONFLICT", constraint: "employees_tenant_cnps_key" },
    });
  });

  it("le même n° CNPS est accepté dans une autre entreprise", async () => {
    await mustCreate(B, U.ownerB);
  });

  it("le comptable ne peut pas créer", async () => {
    expect(await create(ctx(U.accountantA, A), employee({ matricule: "E-009" }))).toEqual({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });
});

describe("lecture", () => {
  it("la liste et la fiche ne contiennent que des valeurs masquées", async () => {
    const res = await list(ctx(U.accountantA, A), {});
    expect(res.ok && res.data.map((e) => e.matricule)).toEqual(["E-001"]);
    const detail = await get(ctx(U.accountantA, A), { id: emp1 });
    expect(detail.ok && detail.data.employee.cnpsNumberMasked).toBe("•••• 5432");
    expect(JSON.stringify(detail)).not.toContain(CNPS);
    expect(JSON.stringify(detail)).not.toMatch(/cnpsNumberEnc|cnpsNumberIndex/);
  });

  it("recherche par nom, prénom ou matricule, sans joker SQL", async () => {
    await mustCreate(A, U.ownerA, {
      matricule: "E-100",
      lastName: "Mbarga",
      firstNames: "Aïcha",
      cnpsNumber: "",
    });
    const by = async (q: string) => {
      const r = await list(ctx(U.ownerA, A), { q });
      return r.ok ? r.data.map((e) => e.matricule) : [];
    };
    expect(await by("mbar")).toEqual(["E-100"]);
    expect(await by("aïcha")).toEqual(["E-100"]);
    expect(await by("E-1")).toEqual(["E-100"]);
    expect(await by("%")).toEqual([]);
  });

  it("anti-IDOR : B ne lit, ne modifie, n'archive ni ne dévoile un salarié de A", async () => {
    const notFound = { ok: false, error: { code: "RULE", reason: "not_found" } };
    expect(await get(ctx(U.ownerB, B), { id: emp1 })).toEqual(notFound);
    expect(
      await update(ctx(U.ownerB, B), { id: emp1, data: employee({ lastName: "Piraté" }) }),
    ).toEqual(notFound);
    expect(await archive(ctx(U.ownerB, B), { id: emp1, endDate: "2025-01-01" })).toEqual(notFound);
    expect(await reveal(ctx(U.ownerB, B), { id: emp1 })).toEqual(notFound);
    expect(
      await updateBank(ctx(U.ownerB, B), {
        id: emp1,
        password: GOOD_PASSWORD,
        bank: { iban: IBAN },
      }),
    ).toEqual(notFound);
    const r = await get(ctx(U.ownerA, A), { id: emp1 });
    expect(r.ok && r.data.employee.lastName).toBe("Fictif");
  });
});

describe("coordonnées bancaires", () => {
  it("exige le mot de passe et n'enregistre rien s'il est faux", async () => {
    expect(
      await updateBank(ctx(U.ownerA, A), { id: emp1, password: "faux", bank: { iban: IBAN } }),
    ).toEqual({
      ok: false,
      error: { code: "RULE", reason: "bad_password" },
    });
    const r = await get(ctx(U.ownerA, A), { id: emp1 });
    expect(r.ok && r.data.bank.ibanMasked).toBeNull();
  });

  it("chiffre l'IBAN et le numéro mobile ; la fiche les montre masqués", async () => {
    const res = await updateBank(ctx(U.ownerA, A), {
      id: emp1,
      password: GOOD_PASSWORD,
      bank: {
        iban: "cm21 1000 2000 3002 7797 6315 008",
        mobileOperator: "orange",
        mobileNumber: "6 99 00 00 42",
      },
    });
    expect(res.ok).toBe(true);
    const r = await get(ctx(U.accountantA, A), { id: emp1 });
    expect(r.ok && r.data.bank).toEqual({
      ibanMasked: "•••• 5008",
      mobileOperator: "orange",
      mobileNumberMasked: "•••• 0042",
    });
    const dump = await rawDump(A, U.ownerA);
    expect(dump).not.toContain(IBAN);
    expect(dump).not.toContain("699000042");
  });

  it("le comptable ne peut ni modifier ni dévoiler", async () => {
    expect(
      await updateBank(ctx(U.accountantA, A), {
        id: emp1,
        password: GOOD_PASSWORD,
        bank: { iban: IBAN },
      }),
    ).toEqual({ ok: false, error: { code: "FORBIDDEN" } });
    expect(await reveal(ctx(U.accountantA, A), { id: emp1 })).toEqual({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });

  it("le propriétaire dévoile les valeurs, et la lecture est auditée", async () => {
    expect(await reveal(ctx(U.ownerA, A), { id: emp1 })).toEqual({
      ok: true,
      data: { cnpsNumber: CNPS, iban: IBAN, mobileNumber: "+237699000042" },
    });
    const rows = await withTenant(db, { tenantId: A, userId: U.ownerA }, (tx) =>
      tx.execute(
        sql`select actor_user_id from audit_log where action = 'employees.reveal_sensitive'`,
      ),
    );
    expect(rows).toHaveLength(1);
  });

  it("un IBAN chiffré copié sur un autre salarié devient illisible", async () => {
    const emp2 = await mustCreate(A, U.ownerA, { matricule: "E-200", cnpsNumber: "" });
    await updateBank(ctx(U.ownerA, A), { id: emp2, password: GOOD_PASSWORD, bank: {} });
    await withTenant(db, { tenantId: A, userId: U.ownerA }, (tx) =>
      tx.execute(sql`update employee_bank_details set iban_enc = (
        select iban_enc from employee_bank_details where employee_id = ${emp1}) where employee_id = ${emp2}`),
    );
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await reveal(ctx(U.ownerA, A), { id: emp2 })).toEqual({
      ok: false,
      error: { code: "INTERNAL" },
    });
    err.mockRestore();
  });
});

describe("modification et archivage", () => {
  it("garde le n° CNPS si le champ est laissé vide", async () => {
    expect(
      (
        await update(ctx(U.ownerA, A), {
          id: emp1,
          data: employee({ cnpsNumber: "", baseSalary: "200000" }),
        })
      ).ok,
    ).toBe(true);
    const r = await reveal(ctx(U.ownerA, A), { id: emp1 });
    expect(r.ok && r.data.cnpsNumber).toBe(CNPS);
  });

  it("archive le salarié : il sort de la liste et n'est plus modifiable", async () => {
    expect(await archive(ctx(U.ownerA, A), { id: emp1, endDate: "2023-01-01" })).toEqual({
      ok: false,
      error: { code: "RULE", reason: "end_before_hire" },
    });
    expect((await archive(ctx(U.ownerA, A), { id: emp1, endDate: "2026-09-30" })).ok).toBe(true);
    const active = await list(ctx(U.ownerA, A), {});
    expect(active.ok && active.data.some((e) => e.id === emp1)).toBe(false);
    const all = await list(ctx(U.ownerA, A), { archived: true });
    expect(all.ok && all.data.some((e) => e.id === emp1)).toBe(true);
    expect(await update(ctx(U.ownerA, A), { id: emp1, data: employee() })).toEqual({
      ok: false,
      error: { code: "RULE", reason: "archived" },
    });
  });

  it("le rôle applicatif ne peut pas supprimer un salarié", async () => {
    await expect(
      withTenant(db, { tenantId: A, userId: U.ownerA }, (tx) => tx.delete(schema.employees)),
    ).rejects.toThrow();
  });
});
