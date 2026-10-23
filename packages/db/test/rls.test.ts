import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { createTenantWithOwner, withTenant, withUser, type NewTenant } from "../src";
import { auditLog, memberships, tenants, users } from "../src/schema";
import { db } from "./db";

const fakeTenant = (n: string): NewTenant => ({
  legalName: `Entreprise fictive ${n}`,
  niu: `M0000000000${n}`,
  cnpsEmployerNumber: `000-000000-${n}`,
  regime: "general",
  workAccidentRate: 175,
  commune: "Douala 1er",
});

const userA = "user-a";
const userB = "user-b";
let tenantA: string;
let tenantB: string;
const asA = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(db, { tenantId: tenantA, userId: userA }, fn);

beforeAll(async () => {
  await db
    .insert(users)
    .values([userA, userB, "user-c"].map((id) => ({ id, name: id, email: `${id}@exemple.test` })));
  tenantA = await withUser(db, userA, (tx) => createTenantWithOwner(tx, userA, fakeTenant("A")));
  tenantB = await withUser(db, userB, (tx) => createTenantWithOwner(tx, userB, fakeTenant("B")));
  await withTenant(db, { tenantId: tenantB, userId: userB }, (tx) =>
    tx.insert(auditLog).values({ tenantId: tenantB, actorUserId: userB, action: "test.b" }),
  );
  await asA((tx) =>
    tx.insert(auditLog).values({ tenantId: tenantA, actorUserId: userA, action: "test.a" }),
  );
});

/** Drizzle emballe l'erreur PostgreSQL : on vérifie le message d'origine. */
async function pgError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    const err = e as Error & { cause?: Error };
    return err.cause?.message ?? err.message;
  }
  throw new Error("la requête aurait dû échouer");
}

afterAll(async () => {
  await db.$client.end();
});

describe("rôle applicatif", () => {
  it("n'est ni superutilisateur ni exempté du RLS", async () => {
    const [role] = await db.execute<{ rolsuper: boolean; rolbypassrls: boolean }>(
      sql`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    );
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
  });
});

describe("isolation entre entreprises", () => {
  it("sans contexte, aucune ligne n'est visible", async () => {
    expect(await db.select().from(tenants)).toHaveLength(0);
    expect(await db.select().from(memberships)).toHaveLength(0);
    expect(await db.select().from(auditLog)).toHaveLength(0);
  });

  it("A ne voit que ses propres lignes, même sans filtre dans la requête", async () => {
    await asA(async (tx) => {
      expect((await tx.select().from(tenants)).map((t) => t.id)).toEqual([tenantA]);
      const ms = await tx.select().from(memberships);
      expect(ms.every((m) => m.tenantId === tenantA)).toBe(true);
      const logs = await tx.select().from(auditLog);
      expect(logs.map((l) => l.action)).toEqual(["test.a"]);
    });
  });

  it("A ne peut pas lire B en ciblant son id", async () => {
    await asA(async (tx) => {
      expect(await tx.select().from(tenants).where(eq(tenants.id, tenantB))).toHaveLength(0);
    });
  });

  it("A ne peut ni modifier ni supprimer les lignes de B", async () => {
    await asA(async (tx) => {
      const updated = await tx
        .update(tenants)
        .set({ legalName: "piraté" })
        .where(eq(tenants.id, tenantB))
        .returning();
      expect(updated).toHaveLength(0);
      const deleted = await tx
        .delete(memberships)
        .where(eq(memberships.tenantId, tenantB))
        .returning();
      expect(deleted).toHaveLength(0);
    });
    await withTenant(db, { tenantId: tenantB, userId: userB }, async (tx) => {
      const [b] = await tx.select().from(tenants);
      expect(b?.legalName).toBe("Entreprise fictive B");
      expect(await tx.select().from(memberships)).toHaveLength(1);
    });
  });

  it("A ne peut pas insérer une ligne dans B", async () => {
    expect(
      await pgError(
        asA((tx) =>
          tx.insert(memberships).values({ tenantId: tenantB, userId: userA, role: "owner" }),
        ),
      ),
    ).toMatch(/row-level security/);
    expect(
      await pgError(asA((tx) => tx.insert(auditLog).values({ tenantId: tenantB, action: "x" }))),
    ).toMatch(/row-level security/);
  });

  it("A ne peut pas déplacer une ligne vers B", async () => {
    expect(
      await pgError(
        asA((tx) =>
          tx.update(memberships).set({ tenantId: tenantB }).where(eq(memberships.userId, userA)),
        ),
      ),
    ).toMatch(/row-level security/);
  });

  it("le contexte ne fuit pas après la transaction", async () => {
    await asA(async () => {});
    expect(await db.select().from(tenants)).toHaveLength(0);
  });
});

describe("contexte utilisateur sans entreprise", () => {
  it("ne voit que ses propres appartenances", async () => {
    await withUser(db, userA, async (tx) => {
      const ms = await tx.select().from(memberships);
      expect(ms.map((m) => [m.tenantId, m.role])).toEqual([[tenantA, "owner"]]);
      expect(await tx.select().from(tenants)).toHaveLength(0);
    });
  });

  it("ne peut pas créer d'appartenance", async () => {
    expect(
      await pgError(
        withUser(db, userA, (tx) =>
          tx.insert(memberships).values({ tenantId: tenantB, userId: userA, role: "owner" }),
        ),
      ),
    ).toMatch(/row-level security/);
  });
});

describe("création d'entreprise", () => {
  it("refuse un NIU déjà utilisé", async () => {
    expect(
      await pgError(
        withUser(db, "user-c", (tx) => createTenantWithOwner(tx, "user-c", fakeTenant("A"))),
      ),
    ).toMatch(/tenants_niu_key/);
  });

  it("refuse un utilisateur vide", async () => {
    expect(
      await pgError(withUser(db, "user-c", (tx) => createTenantWithOwner(tx, "", fakeTenant("C")))),
    ).toMatch(/utilisateur requis/);
  });

  it("le rôle applicatif ne peut pas insérer directement une entreprise", async () => {
    expect(await pgError(db.insert(tenants).values({ id: uuidv7(), ...fakeTenant("D") }))).toMatch(
      /permission denied/,
    );
  });
});

describe("journal d'audit", () => {
  it("est en insertion seule", async () => {
    expect(await pgError(asA((tx) => tx.update(auditLog).set({ action: "effacé" })))).toMatch(
      /permission denied/,
    );
    expect(await pgError(asA((tx) => tx.delete(auditLog)))).toMatch(/permission denied/);
  });

  it("accepte les événements hors entreprise", async () => {
    await db.insert(auditLog).values({ action: "auth.login_failed" });
  });
});

describe("garde-fous de withTenant", () => {
  it("refuse un tenantId mal formé ou un utilisateur vide", async () => {
    await expect(
      withTenant(db, { tenantId: "' or 1=1 --", userId: userA }, async () => {}),
    ).rejects.toThrow(/tenantId invalide/);
    await expect(withTenant(db, { tenantId: tenantA, userId: "" }, async () => {})).rejects.toThrow(
      /userId requis/,
    );
    await expect(withUser(db, "", async () => {})).rejects.toThrow(/userId requis/);
  });
});
