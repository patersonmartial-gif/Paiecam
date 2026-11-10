import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createTenantWithOwner, withTenant, withUser, type NewTenant, type Tx } from "../src";
import { catalogItems, stockLots, stockMovements, users } from "../src/schema";
import { db } from "./db";

const fake = (n: string): NewTenant => ({
  legalName: `Pharmacie fictive ${n}`,
  niu: `S0000000000${n}`,
  cnpsEmployerNumber: `000-000000-${n}`,
  regime: "general",
  workAccidentRate: 175,
  commune: "Bafoussam 2e",
});
let A = "";
let B = "";
let medicine = "";
let service = "";
const asA = <T>(fn: (tx: Tx) => Promise<T>) =>
  withTenant(db, { tenantId: A, userId: "stk-owner-a" }, fn);
const asB = <T>(fn: (tx: Tx) => Promise<T>) =>
  withTenant(db, { tenantId: B, userId: "stk-owner-b" }, fn);

async function pgError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const err = e as Error & { cause?: Error };
    return err.cause?.message ?? err.message;
  }
  return "aucune erreur";
}

const newLot = (
  expiryDate = "2028-12-31",
  lotNumber = `L-${Math.random().toString(36).slice(2, 8)}`,
) =>
  asA(async (tx) => {
    const [l] = await tx
      .insert(stockLots)
      .values({
        tenantId: A,
        itemId: medicine,
        lotNumber,
        expiryDate,
        unitCost: 600,
        receivedBy: "stk-owner-a",
      })
      .returning();
    return l?.id ?? "";
  });
const move = (
  lotId: string,
  kind: typeof stockMovements.$inferInsert.kind,
  quantity: number,
  reason?: string,
) =>
  asA((tx) =>
    tx.insert(stockMovements).values({
      tenantId: A,
      lotId,
      kind,
      quantity,
      reason: reason ?? null,
      createdBy: "stk-owner-a",
    }),
  );
const onHand = async (lotId: string) =>
  (
    await asA((tx) =>
      tx.select({ q: stockLots.quantityOnHand }).from(stockLots).where(eq(stockLots.id, lotId)),
    )
  )[0]?.q;

beforeAll(async () => {
  await db
    .insert(users)
    .values(
      ["stk-owner-a", "stk-owner-b"].map((id) => ({ id, name: id, email: `${id}@exemple.test` })),
    );
  A = await withUser(db, "stk-owner-a", (tx) =>
    createTenantWithOwner(tx, "stk-owner-a", fake("A")),
  );
  B = await withUser(db, "stk-owner-b", (tx) =>
    createTenantWithOwner(tx, "stk-owner-b", fake("B")),
  );
  const rows = await asA((tx) =>
    tx
      .insert(catalogItems)
      .values([
        {
          tenantId: A,
          kind: "medicine",
          code: "AMOX-500",
          name: "Amoxicilline 500 mg",
          taxCategory: "exempt",
        },
        { tenantId: A, kind: "service", code: "CONS", name: "Consultation", taxCategory: "exempt" },
      ])
      .returning(),
  );
  medicine = rows[0]?.id ?? "";
  service = rows[1]?.id ?? "";
});

afterAll(async () => {
  await db.$client.end();
});

describe("stock : registre des mouvements imposé par la base", () => {
  it("lot créé vide, médicament seulement ; la réception est un mouvement", async () => {
    const lot = await newLot();
    expect(await onHand(lot)).toBe(0);
    await move(lot, "reception", 100);
    expect(await onHand(lot)).toBe(100);
    expect(
      await pgError(
        asA((tx) =>
          tx.insert(stockLots).values({
            tenantId: A,
            itemId: medicine,
            lotNumber: "PLEIN",
            expiryDate: "2028-01-01",
            unitCost: 1,
            quantityOnHand: 50,
            receivedBy: "x",
          }),
        ),
      ),
    ).toMatch(/créé vide/);
    expect(
      await pgError(
        asA((tx) =>
          tx.insert(stockLots).values({
            tenantId: A,
            itemId: service,
            lotNumber: "S",
            expiryDate: "2028-01-01",
            unitCost: 1,
            receivedBy: "x",
          }),
        ),
      ),
    ).toMatch(/qu'un médicament/);
  });

  it("jamais de stock négatif, même avec deux ventes simultanées", async () => {
    const lot = await newLot();
    await move(lot, "reception", 10);
    expect(await pgError(move(lot, "sale", -11))).toMatch(/stock insuffisant/);
    const results = await Promise.allSettled([move(lot, "sale", -7), move(lot, "sale", -7)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await onHand(lot)).toBe(3);
  });

  it("vente d'un lot périmé refusée ; sortie « périmé » acceptée avec motif", async () => {
    const lot = await newLot("2020-01-31");
    await move(lot, "reception", 5);
    expect(await pgError(move(lot, "sale", -1))).toMatch(/périmé/);
    expect(await pgError(move(lot, "expired", -5))).toMatch(/reason_chk/);
    await move(lot, "expired", -5, "Retrait des périmés");
    expect(await onHand(lot)).toBe(0);
  });

  it("sens des mouvements contrôlés ; inventaire dans les deux sens, avec motif", async () => {
    const lot = await newLot();
    await move(lot, "reception", 20);
    expect(await pgError(move(lot, "reception", -1))).toMatch(/sign_chk/);
    expect(await pgError(move(lot, "sale", 1))).toMatch(/sign_chk/);
    expect(await pgError(move(lot, "inventory", 0, "Comptage"))).toMatch(/quantity_chk/);
    await move(lot, "inventory", -2, "Comptage mensuel");
    await move(lot, "inventory", 1, "Boîte retrouvée");
    expect(await onHand(lot)).toBe(19);
  });

  it("ni modification directe d'un lot, ni modification ou suppression du registre", async () => {
    const lot = await newLot();
    await move(lot, "reception", 4);
    expect(
      await pgError(
        asA((tx) => tx.update(stockLots).set({ quantityOnHand: 999 }).where(eq(stockLots.id, lot))),
      ),
    ).toMatch(/que par un mouvement/);
    expect(
      await pgError(
        asA((tx) => tx.update(stockLots).set({ unitCost: 1 }).where(eq(stockLots.id, lot))),
      ),
    ).toMatch(/permission denied/);
    expect(
      await pgError(
        asA((tx) =>
          tx.update(stockMovements).set({ quantity: 1000 }).where(eq(stockMovements.lotId, lot)),
        ),
      ),
    ).toMatch(/permission denied/);
    expect(
      await pgError(asA((tx) => tx.delete(stockMovements).where(eq(stockMovements.lotId, lot)))),
    ).toMatch(/permission denied/);
    expect(await onHand(lot)).toBe(4);
  });
});

describe("stock : isolation entre entreprises", () => {
  it("B ne voit pas le stock de A et ne peut pas y faire de mouvement", async () => {
    const lot = await newLot();
    await move(lot, "reception", 3);
    expect(await asB((tx) => tx.select().from(stockLots))).toEqual([]);
    expect(
      await asB((tx) => tx.select({ n: sql<number>`count(*)::int` }).from(stockMovements)),
    ).toEqual([{ n: 0 }]);
    expect(
      await pgError(
        asB((tx) =>
          tx
            .insert(stockMovements)
            .values({ tenantId: B, lotId: lot, kind: "sale", quantity: -1, createdBy: "b" }),
        ),
      ),
    ).not.toBe("aucune erreur");
    expect(await onHand(lot)).toBe(3);
  });
});
