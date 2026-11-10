import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createDb,
  createTenantWithOwner,
  eq,
  schema,
  sql,
  withTenant,
  withUser,
  type NewTenant,
} from "@paiecam/db";
import { testDatabaseUrl } from "@paiecam/db/testing";
import { createTenantAction, createUserAction, type RequestContext } from "@/server/authz/action";
import { can, PERMISSIONS, ROLE_PERMISSIONS, type Role } from "@/server/authz/permissions";
import { MASK } from "@/server/log";

const db = createDb(testDatabaseUrl());

const fakeTenant = (n: string): NewTenant => ({
  legalName: `Entreprise fictive ${n}`,
  niu: `P0000000000${n}`,
  cnpsEmployerNumber: `000-000000-${n}`,
  regime: "general",
  workAccidentRate: 175,
  commune: "Yaoundé 3e",
});

const ids = {
  ownerA: "authz-owner-a",
  managerA: "authz-manager-a",
  managerA2fa: "authz-manager-a-2fa",
  accountantA: "authz-accountant-a",
  employeeA: "authz-employee-a",
  ownerB: "authz-owner-b",
};
let tenantA = "";
let tenantB = "";

function ctx(
  userId: string | null,
  tenantId: string | null,
  twoFactorEnabled = true,
): RequestContext {
  return {
    user: userId ? { id: userId, twoFactorEnabled } : null,
    tenantId,
    ip: "203.0.113.10",
    userAgent: "vitest",
  };
}

/** Action témoin : renommer l'entreprise courante. */
const rename = createTenantAction(
  db,
  {
    permission: "tenant:update",
    input: z.object({ legalName: z.string().min(2) }),
    audit: "tenant.rename",
  },
  async ({ tx, tenantId, audit }, input) => {
    const [before] = await tx.select().from(schema.tenants);
    await tx.update(schema.tenants).set({ legalName: input.legalName });
    audit({
      entityType: "tenant",
      entityId: tenantId,
      before: { legalName: before?.legalName, niu: before?.niu },
      after: input,
    });
    return { tenantId };
  },
);

const readTenant = createTenantAction(
  db,
  { permission: "tenant:read", input: z.object({}), audit: "tenant.read" },
  async ({ tx }) => (await tx.select().from(schema.tenants))[0]?.legalName,
);

async function legalName(tenantId: string, userId: string) {
  return withTenant(
    db,
    { tenantId, userId },
    async (tx) => (await tx.select().from(schema.tenants))[0]?.legalName,
  );
}

/** Lit le journal comme le ferait un membre de l'entreprise (sous RLS). */
async function auditRows(action: string, tenantId: string, userId: string) {
  return withTenant(db, { tenantId, userId }, (tx) =>
    tx.execute<{
      tenant_id: string | null;
      actor_user_id: string;
      after: unknown;
      before: unknown;
      ip: string;
    }>(
      sql`select tenant_id, actor_user_id, before, after, host(ip) as ip from audit_log where action = ${action} order by created_at`,
    ),
  );
}

beforeAll(async () => {
  await db
    .insert(schema.users)
    .values(Object.values(ids).map((id) => ({ id, name: id, email: `${id}@exemple.test` })));
  tenantA = await withUser(db, ids.ownerA, (tx) =>
    createTenantWithOwner(tx, ids.ownerA, fakeTenant("A")),
  );
  tenantB = await withUser(db, ids.ownerB, (tx) =>
    createTenantWithOwner(tx, ids.ownerB, fakeTenant("B")),
  );
  await withTenant(db, { tenantId: tenantA, userId: ids.ownerA }, (tx) =>
    tx.insert(schema.memberships).values([
      { tenantId: tenantA, userId: ids.managerA, role: "payroll_manager" },
      { tenantId: tenantA, userId: ids.managerA2fa, role: "payroll_manager" },
      { tenantId: tenantA, userId: ids.accountantA, role: "accountant" },
      { tenantId: tenantA, userId: ids.employeeA, role: "employee" },
    ]),
  );
});

afterAll(async () => {
  await db.$client.end();
});

describe("matrice des rôles", () => {
  const expected: Record<Role, string[]> = {
    owner: [...PERMISSIONS],
    payroll_manager: [
      "tenant:read",
      "members:read",
      "employees:read",
      "employees:write",
      "employees:sensitive",
      "payroll:read",
      "payroll:run",
      "payroll:validate",
      "declarations:read",
      "declarations:generate",
    ],
    accountant: PERMISSIONS.filter((p) => p.endsWith(":read")),
    employee: [],
    cashier: ["tenant:read", "catalog:read", "billing:read", "billing:issue", "stock:read"],
    stock_manager: ["tenant:read", "catalog:read", "stock:read", "stock:manage"],
  };

  it.each(Object.keys(expected) as Role[])("%s a exactement ses droits", (role) => {
    expect(PERMISSIONS.filter((p) => can(role, p))).toEqual(expected[role]);
  });

  it("le comptable ne peut rien modifier", () => {
    expect(ROLE_PERMISSIONS.accountant.every((p) => p.endsWith(":read"))).toBe(true);
  });
});

describe("createTenantAction", () => {
  it("1) refuse sans session", async () => {
    expect(await rename(ctx(null, tenantA), { legalName: "X" })).toEqual({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
  });

  it("refuse sans entreprise ou avec un identifiant mal formé", async () => {
    expect((await rename(ctx(ids.ownerA, null), {})).ok).toBe(false);
    expect(await rename(ctx(ids.ownerA, "pas-un-uuid"), {})).toEqual({
      ok: false,
      error: { code: "NO_TENANT" },
    });
  });

  it("2) anti-IDOR : le propriétaire de A ne peut pas agir sur B", async () => {
    const res = await rename(ctx(ids.ownerA, tenantB), { legalName: "Piraté" });
    expect(res).toEqual({ ok: false, error: { code: "FORBIDDEN" } });
    expect(await legalName(tenantB, ids.ownerB)).toBe("Entreprise fictive B");
    expect(await readTenant(ctx(ids.ownerA, tenantB), {})).toEqual({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });

  it("2) refuse un rôle sans la permission, et trace le refus", async () => {
    expect(await rename(ctx(ids.accountantA, tenantA), { legalName: "X" })).toEqual({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(await rename(ctx(ids.employeeA, tenantA), { legalName: "X" })).toEqual({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    const deniedA = await auditRows("denied:tenant.rename", tenantA, ids.ownerA);
    expect(deniedA.map((r) => r.actor_user_id)).toEqual([ids.accountantA, ids.employeeA]);
    // La tentative du propriétaire de A sur B apparaît dans le journal de B.
    const deniedB = await auditRows("denied:tenant.rename", tenantB, ids.ownerB);
    expect(deniedB.map((r) => r.actor_user_id)).toEqual([ids.ownerA]);
    expect(deniedB[0]?.after).toEqual({ reason: "FORBIDDEN" });
  });

  it("2) le comptable peut lire", async () => {
    expect(await readTenant(ctx(ids.accountantA, tenantA, false), {})).toEqual({
      ok: true,
      data: "Entreprise fictive A",
    });
  });

  it("2) exige la 2FA du propriétaire et du gestionnaire paie", async () => {
    expect(await readTenant(ctx(ids.managerA, tenantA, false), {})).toEqual({
      ok: false,
      error: { code: "TWO_FACTOR_REQUIRED" },
    });
    expect(await rename(ctx(ids.ownerA, tenantA, false), { legalName: "X" })).toEqual({
      ok: false,
      error: { code: "TWO_FACTOR_REQUIRED" },
    });
    expect((await readTenant(ctx(ids.managerA2fa, tenantA, true), {})).ok).toBe(true);
  });

  it("3) valide l'entrée, mais seulement après l'autorisation", async () => {
    const invalid = await rename(ctx(ids.ownerA, tenantA), { legalName: "" });
    expect(invalid.ok === false && invalid.error.code).toBe("INVALID_INPUT");
    // Un utilisateur non autorisé n'apprend rien sur le format attendu.
    expect(await rename(ctx(ids.accountantA, tenantA), { legalName: "" })).toEqual({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });

  it("4-5) exécute sous RLS et écrit un audit masqué dans la même transaction", async () => {
    const res = await rename(ctx(ids.ownerA, tenantA), { legalName: "Entreprise fictive A2" });
    expect(res).toEqual({ ok: true, data: { tenantId: tenantA } });
    expect(await legalName(tenantA, ids.ownerA)).toBe("Entreprise fictive A2");
    const [row] = await auditRows("tenant.rename", tenantA, ids.ownerA);
    expect(row).toMatchObject({
      tenant_id: tenantA,
      actor_user_id: ids.ownerA,
      ip: "203.0.113.10",
      before: { legalName: "Entreprise fictive A", niu: MASK },
      after: { legalName: "Entreprise fictive A2" },
    });
  });

  it("annule l'action et l'audit si le traitement échoue", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = createTenantAction(
      db,
      { permission: "tenant:update", input: z.object({}), audit: "tenant.failing" },
      async ({ tx }) => {
        await tx.update(schema.tenants).set({ legalName: "Ne doit pas rester" });
        throw new Error("panne simulée");
      },
    );
    expect(await failing(ctx(ids.ownerA, tenantA), {})).toEqual({
      ok: false,
      error: { code: "INTERNAL" },
    });
    expect(await legalName(tenantA, ids.ownerA)).toBe("Entreprise fictive A2");
    expect(await auditRows("tenant.failing", tenantA, ids.ownerA)).toHaveLength(0);
    err.mockRestore();
  });
});

describe("createUserAction", () => {
  const createCompany = createUserAction(
    db,
    { input: z.object({ niu: z.string() }), audit: "tenant.create" },
    async ({ tx, userId }, input) => {
      const tenantId = await createTenantWithOwner(tx, userId, {
        ...fakeTenant("C"),
        niu: input.niu,
      });
      return { data: tenantId, tenantId };
    },
  );

  it("crée l'entreprise, le Propriétaire et l'audit rattaché", async () => {
    await db
      .insert(schema.users)
      .values({ id: "authz-new", name: "n", email: "authz-new@exemple.test" });
    const res = await createCompany(ctx("authz-new", null, false), { niu: "P00000000NEW" });
    expect(res.ok).toBe(true);
    const tenantId = res.ok ? res.data : "";
    const [row] = await auditRows("tenant.create", tenantId, "authz-new");
    expect(row).toMatchObject({ tenant_id: tenantId, actor_user_id: "authz-new" });
    const [m] = await withUser(db, "authz-new", (tx) =>
      tx.select().from(schema.memberships).where(eq(schema.memberships.userId, "authz-new")),
    );
    expect(m).toMatchObject({ tenantId, role: "owner" });
  });

  it("signale un NIU déjà inscrit", async () => {
    expect(await createCompany(ctx("authz-new", null), { niu: "P0000000000A" })).toEqual({
      ok: false,
      error: { code: "CONFLICT", constraint: "tenants_niu_key" },
    });
  });

  it("refuse sans session ou avec une entrée invalide", async () => {
    expect(await createCompany(ctx(null, null), { niu: "x" })).toEqual({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
    const res = await createCompany(ctx("authz-new", null), { niu: 3 });
    expect(res.ok === false && res.error.code).toBe("INVALID_INPUT");
  });

  it("journalise une panne sans fuite de données", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = createUserAction(db, { input: z.object({}), audit: "x" }, async () => {
      throw new Error("panne pour jean@exemple.test");
    });
    expect(await failing(ctx("authz-new", null), {})).toEqual({
      ok: false,
      error: { code: "INTERNAL" },
    });
    expect(String(err.mock.calls[0]?.[0])).not.toContain("jean@exemple.test");
    err.mockRestore();
  });
});
