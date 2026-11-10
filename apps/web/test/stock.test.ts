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
import type { RequestContext } from "@/server/authz/action";
import { makeCreateCatalogItem } from "@/server/features/catalog";
import {
  allocateFefo,
  makeItemStock,
  makeReceiveStock,
  makeSetExpiryAlertDays,
  makeStockAdjustment,
  makeStockOverview,
} from "@/server/features/stock";

const db = createDb(testDatabaseUrl());
const receive = makeReceiveStock(db);
const adjust = makeStockAdjustment(db);
const overview = makeStockOverview(db);
const itemStock = makeItemStock(db);
const setDays = makeSetExpiryAlertDays(db);

const fake = (n: string): NewTenant => ({
  legalName: `Clinique stock fictive ${n}`,
  niu: `K0000000000${n}`,
  cnpsEmployerNumber: `000-000000-${n}`,
  regime: "general",
  workAccidentRate: 175,
  commune: "Garoua 1er",
});
const U = { owner: "st-owner", stock: "st-stock", cashier: "st-cashier", ownerB: "st-owner-b" };
let A = "";
let B = "";
let amox = "";
let ibu = "";
const ctx = (userId: string, tenantId = A): RequestContext => ({
  user: { id: userId, twoFactorEnabled: true },
  tenantId,
  ip: "203.0.113.120",
  userAgent: "vitest",
});
const ok = <T>(r: { ok: true; data: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.data;
};
const rule = (reason: string) => ({ ok: false, error: { code: "RULE", reason } });
const medicine = (code: string, name: string, threshold: string) => ({
  kind: "medicine",
  code,
  name,
  unit: "Boîte",
  taxCategory: "exempt",
  alertThreshold: threshold,
  priceTtc: "2000",
});

beforeAll(async () => {
  await db
    .insert(schema.users)
    .values(Object.values(U).map((id) => ({ id, name: id, email: `${id}@exemple.test` })));
  A = await withUser(db, U.owner, (tx) => createTenantWithOwner(tx, U.owner, fake("A")));
  B = await withUser(db, U.ownerB, (tx) => createTenantWithOwner(tx, U.ownerB, fake("B")));
  await withTenant(db, { tenantId: A, userId: U.owner }, (tx) =>
    tx.insert(schema.memberships).values([
      { tenantId: A, userId: U.stock, role: "stock_manager" },
      { tenantId: A, userId: U.cashier, role: "cashier" },
    ]),
  );
  const create = makeCreateCatalogItem(db);
  amox = ok(await create(ctx(U.owner), medicine("AMOX", "Amoxicilline 500 mg", "20"))).id;
  ibu = ok(await create(ctx(U.owner), medicine("IBU", "Ibuprofène 400 mg", "5"))).id;
});

afterAll(async () => {
  await db.$client.end();
});

describe("stock par lot", () => {
  it("réception : lots créés, péremption future exigée, coût cohérent pour un même lot", async () => {
    ok(
      await receive(ctx(U.stock), {
        itemId: amox,
        lotNumber: "A-2030",
        expiryDate: "2030-06-30",
        quantity: "30",
        unitCost: "900",
        supplier: "Grossiste fictif",
      }),
    );
    ok(
      await receive(ctx(U.stock), {
        itemId: amox,
        lotNumber: "A-2029",
        expiryDate: "2029-03-31",
        quantity: "10",
        unitCost: "850",
      }),
    );
    // Même lot livré une seconde fois : quantité ajoutée au lot existant.
    ok(
      await receive(ctx(U.stock), {
        itemId: amox,
        lotNumber: "A-2029",
        expiryDate: "2029-03-31",
        quantity: "5",
        unitCost: "850",
      }),
    );
    expect(
      await receive(ctx(U.stock), {
        itemId: amox,
        lotNumber: "A-2029",
        expiryDate: "2029-03-31",
        quantity: "1",
        unitCost: "999",
      }),
    ).toEqual(rule("lot_cost_mismatch"));
    expect(
      await receive(ctx(U.stock), {
        itemId: amox,
        lotNumber: "VIEUX",
        expiryDate: "2020-01-01",
        quantity: "1",
        unitCost: "1",
      }),
    ).toEqual(rule("already_expired"));
    const detail = ok(await itemStock(ctx(U.cashier), { itemId: amox }));
    expect(detail.lots.map((l) => [l.lotNumber, l.quantityOnHand])).toEqual([
      ["A-2029", 15],
      ["A-2030", 30],
    ]);
    expect(detail.history).toHaveLength(3);
  });

  it("FEFO : la péremption la plus proche sort d'abord ; stock insuffisant refusé", async () => {
    const plan = await withTenant(db, { tenantId: A, userId: U.cashier }, (tx) =>
      allocateFefo(tx, amox, 20, "2026-11-10"),
    );
    expect(plan.map((p) => [p.lotNumber, p.quantity])).toEqual([
      ["A-2029", 15],
      ["A-2030", 5],
    ]);
    await expect(
      withTenant(db, { tenantId: A, userId: U.cashier }, (tx) =>
        allocateFefo(tx, amox, 46, "2026-11-10"),
      ),
    ).rejects.toMatchObject({ reason: "insufficient_stock" });
    // Après la péremption du premier lot, seul le second est vendable.
    const later = await withTenant(db, { tenantId: A, userId: U.cashier }, (tx) =>
      allocateFefo(tx, amox, 5, "2029-04-01"),
    );
    expect(later.map((p) => p.lotNumber)).toEqual(["A-2030"]);
  });

  it("vue d'ensemble : disponible, valeur, alertes de rupture et de péremption", async () => {
    const view = ok(await overview(ctx(U.cashier), { today: "2029-01-15" }));
    const a = view.medicines.find((m) => m.code === "AMOX");
    expect(a).toMatchObject({
      available: 45,
      expiringSoon: 15,
      nextExpiry: "2029-03-31",
      value: 15 * 850 + 30 * 900,
      alerts: ["expiring_soon"],
    });
    expect(view.medicines.find((m) => m.code === "IBU")?.alerts).toEqual(["out_of_stock"]);
    expect(view.totalValue).toBe(15 * 850 + 30 * 900);
    const after = ok(await overview(ctx(U.cashier), { today: "2029-04-01" }));
    expect(after.medicines.find((m) => m.code === "AMOX")).toMatchObject({
      available: 30,
      expired: 15,
      // Le lot restant périme en juin 2030 : hors du délai d'alerte de 90 jours.
      alerts: ["expired_on_hand"],
    });
    // Délai d'alerte réglable par le propriétaire.
    ok(await setDays(ctx(U.owner), { days: "30" }));
    const shorter = ok(await overview(ctx(U.cashier), { today: "2029-01-15" }));
    expect(shorter.medicines.find((m) => m.code === "AMOX")?.alerts).toEqual([]);
    expect(shorter.alertDays).toBe(30);
  });

  it("casse, périmés et inventaire : motif exigé, quantité contrôlée", async () => {
    const [lot] = ok(await itemStock(ctx(U.stock), { itemId: amox })).lots;
    const lotId = lot?.id ?? "";
    ok(
      await adjust(ctx(U.stock), {
        lotId,
        kind: "breakage",
        quantity: "2",
        reason: "Flacon cassé",
      }),
    );
    expect(
      await adjust(ctx(U.stock), { lotId, kind: "breakage", quantity: "99", reason: "Trop" }),
    ).toEqual(rule("insufficient_stock"));
    expect(
      await adjust(ctx(U.stock), { lotId, kind: "breakage", quantity: "1", reason: "" }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    // Inventaire : 13 en théorie, 11 comptés.
    expect(
      ok(
        await adjust(ctx(U.stock), {
          lotId,
          kind: "inventory",
          quantity: "11",
          reason: "Comptage",
        }),
      ),
    ).toEqual({ lotId, delta: -2 });
    expect(
      ok(
        await adjust(ctx(U.stock), {
          lotId,
          kind: "inventory",
          quantity: "11",
          reason: "Recomptage",
        }),
      ),
    ).toEqual({ lotId, delta: 0 });
    const detail = ok(await itemStock(ctx(U.stock), { itemId: amox }));
    expect(detail.lots.find((l) => l.id === lotId)?.quantityOnHand).toBe(11);
  });

  it("droits : le caissier consulte mais ne gère pas le stock ; isolation entre entreprises", async () => {
    expect(
      await receive(ctx(U.cashier), {
        itemId: ibu,
        lotNumber: "I-1",
        expiryDate: "2030-01-01",
        quantity: "1",
        unitCost: "1",
      }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(await setDays(ctx(U.stock), { days: "60" })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(ok(await overview(ctx(U.ownerB, B), {})).medicines).toEqual([]);
    expect(await itemStock(ctx(U.ownerB, B), { itemId: amox })).toEqual(rule("not_found"));
    expect(
      await receive(ctx(U.ownerB, B), {
        itemId: amox,
        lotNumber: "PIRATE",
        expiryDate: "2030-01-01",
        quantity: "1",
        unitCost: "1",
      }),
    ).toEqual(rule("not_found"));
  });
});
