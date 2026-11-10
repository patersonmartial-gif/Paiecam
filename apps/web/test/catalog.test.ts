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
import { testDatabaseUrl } from "@paiecam/db/testing";
import type { RequestContext } from "@/server/authz/action";
import {
  makeCreateCatalogItem,
  makeListCatalog,
  makePriceHistory,
  makeSetPrice,
  makeUpdateCatalogItem,
} from "@/server/features/catalog";

const db = createDb(testDatabaseUrl());
const create = makeCreateCatalogItem(db);
const list = makeListCatalog(db);
const setPrice = makeSetPrice(db);
const update = makeUpdateCatalogItem(db);
const history = makePriceHistory(db);

const fake = (n: string): NewTenant => ({
  legalName: `Clinique fictive ${n}`,
  niu: `C0000000000${n}`,
  cnpsEmployerNumber: `000-000000-${n}`,
  regime: "general",
  workAccidentRate: 175,
  commune: "Douala 5e",
});
const U = { owner: "cat-owner", cashier: "cat-cashier", stock: "cat-stock", ownerB: "cat-owner-b" };
let A = "";
let B = "";
const ctx = (userId: string, tenantId = A): RequestContext => ({
  user: { id: userId, twoFactorEnabled: true },
  tenantId,
  ip: "203.0.113.110",
  userAgent: "vitest",
});
const ok = <T>(r: { ok: true; data: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.data;
};
const paracetamol = {
  kind: "medicine",
  code: "para-500",
  name: "Paracétamol 500 mg",
  form: "Comprimé",
  dosage: "500 mg",
  unit: "Boîte de 20",
  taxCategory: "standard",
  alertThreshold: "10",
  priceTtc: "1500",
};

beforeAll(async () => {
  await db
    .insert(schema.users)
    .values(Object.values(U).map((id) => ({ id, name: id, email: `${id}@exemple.test` })));
  A = await withUser(db, U.owner, (tx) => createTenantWithOwner(tx, U.owner, fake("A")));
  B = await withUser(db, U.ownerB, (tx) => createTenantWithOwner(tx, U.ownerB, fake("B")));
  await withTenant(db, { tenantId: A, userId: U.owner }, (tx) =>
    tx.insert(schema.memberships).values([
      { tenantId: A, userId: U.cashier, role: "cashier" },
      { tenantId: A, userId: U.stock, role: "stock_manager" },
    ]),
  );
});

afterAll(async () => {
  await db.$client.end();
});

describe("catalogue et prix", () => {
  let id = "";

  it("le propriétaire crée un médicament avec son prix ; code normalisé", async () => {
    id = ok(await create(ctx(U.owner), paracetamol)).id;
    ok(
      await create(ctx(U.owner), {
        kind: "service",
        code: "CONS-GEN",
        name: "Consultation générale",
        taxCategory: "exempt",
        priceTtc: "5000",
      }),
    );
    expect(ok(await list(ctx(U.cashier), {}))).toMatchObject([
      { kind: "service", code: "CONS-GEN", priceTtc: 5000, taxCategory: "exempt" },
      {
        kind: "medicine",
        code: "PARA-500",
        priceTtc: 1500,
        unit: "Boîte de 20",
        alertThreshold: 10,
      },
    ]);
  });

  it("seul le propriétaire fixe les prix ; caissier et gestionnaire de stock consultent", async () => {
    for (const who of [U.cashier, U.stock]) {
      expect(await setPrice(ctx(who), { id, priceTtc: "1" })).toMatchObject({
        ok: false,
        error: { code: "FORBIDDEN" },
      });
      expect(await create(ctx(who), { ...paracetamol, code: "X" })).toMatchObject({
        ok: false,
        error: { code: "FORBIDDEN" },
      });
    }
    expect(ok(await list(ctx(U.stock), { kind: "medicine" }))).toHaveLength(1);
  });

  it("nouveau prix : historique conservé, sans doublon si le prix ne change pas", async () => {
    expect(ok(await setPrice(ctx(U.owner), { id, priceTtc: "1750" }))).toEqual({
      id,
      changed: true,
    });
    expect(ok(await setPrice(ctx(U.owner), { id, priceTtc: "1750" }))).toEqual({
      id,
      changed: false,
    });
    expect(ok(await history(ctx(U.cashier), { id })).map((h) => h.priceTtc)).toEqual([1750, 1500]);
    const medicines = ok(await list(ctx(U.cashier), { kind: "medicine" }));
    expect(medicines[0]?.priceTtc).toBe(1750);
  });

  it("un prix fixé ne se modifie ni ne se supprime ; un article ne se supprime pas", async () => {
    const asA = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
      withTenant(db, { tenantId: A, userId: U.owner }, fn);
    const pgError = async (p: Promise<unknown>) => {
      try {
        await p;
        return "aucune erreur";
      } catch (e) {
        return (e as Error & { cause?: Error }).cause?.message ?? (e as Error).message;
      }
    };
    expect(
      await pgError(asA((tx) => tx.update(schema.catalogPrices).set({ priceTtc: 1 }))),
    ).toMatch(/permission denied/);
    expect(
      await pgError(
        asA((tx) => tx.delete(schema.catalogItems).where(eq(schema.catalogItems.id, id))),
      ),
    ).toMatch(/permission denied|ne se supprime pas/);
    expect(
      await pgError(
        asA((tx) =>
          tx
            .update(schema.catalogItems)
            .set({ kind: "service" })
            .where(eq(schema.catalogItems.id, id)),
        ),
      ),
    ).toMatch(/immuables/);
  });

  it("désactivation et mise à jour ; codes uniques par entreprise", async () => {
    ok(await update(ctx(U.owner), { id, ...paracetamol, active: false }));
    expect(ok(await list(ctx(U.owner), { kind: "medicine" }))[0]?.active).toBe(false);
    expect(await create(ctx(U.owner), paracetamol)).toMatchObject({
      ok: false,
      error: { code: "CONFLICT" },
    });
    // Une autre entreprise peut utiliser le même code.
    ok(await create(ctx(U.ownerB, B), paracetamol));
  });

  it("isolation : B ne voit ni ne modifie le catalogue de A", async () => {
    expect(ok(await list(ctx(U.ownerB, B), {})).map((i) => i.code)).toEqual(["PARA-500"]);
    expect(await setPrice(ctx(U.ownerB, B), { id, priceTtc: "1" })).toEqual({
      ok: false,
      error: { code: "RULE", reason: "not_found" },
    });
    expect(await history(ctx(U.ownerB, B), { id })).toEqual({
      ok: false,
      error: { code: "RULE", reason: "not_found" },
    });
  });
});
