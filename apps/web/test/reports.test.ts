import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDb,
  createTenantWithOwner,
  schema,
  withTenant,
  withUser,
  type NewTenant,
} from "@paiecam/db";
import { loadTestRules, testDatabaseUrl } from "@paiecam/db/testing";
import { loadRuleFile } from "@paiecam/paie-engine/rules";
import { parseKeyring } from "@paiecam/security";
import type { RequestContext } from "@/server/authz/action";
import { makeCancelInvoice, makeIssueInvoice } from "@/server/features/billing";
import { makeCreateCatalogItem } from "@/server/features/catalog";
import { todayInDouala } from "@/server/features/reminders";
import { makeCloseDay, makeListClosings, makeSalesReport } from "@/server/features/reports";
import { makeReceiveStock } from "@/server/features/stock";

const db = createDb(testDatabaseUrl());
const keyring = parseKeyring(`v1:${Buffer.alloc(32, 22).toString("base64")}`);
const issue = makeIssueInvoice(db, { keyring, allowDraftRules: true });
const cancel = makeCancelInvoice(db, { keyring, verifyPassword: async () => true });
const report = makeSalesReport(db);
const closeDay = makeCloseDay(db);
const closings = makeListClosings(db);

const fake = (n: string): NewTenant => ({
  legalName: `Clinique rapport fictive ${n}`,
  niu: `R1000000000${n}`,
  cnpsEmployerNumber: `000-000000-${n}`,
  regime: "general",
  workAccidentRate: 175,
  commune: "Ngaoundéré 1er",
});
const U = {
  owner: "rp-owner",
  cashier: "rp-cashier",
  accountant: "rp-accountant",
  ownerB: "rp-owner-b",
};
let A = "";
let B = "";
const item: Record<string, string> = {};
const ctx = (userId: string, tenantId = A): RequestContext => ({
  user: { id: userId, twoFactorEnabled: true },
  tenantId,
  ip: "203.0.113.140",
  userAgent: "vitest",
});
const ok = <T>(r: { ok: true; data: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.data;
};
const today = todayInDouala();

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
    tx.insert(schema.memberships).values([
      { tenantId: A, userId: U.cashier, role: "cashier" },
      { tenantId: A, userId: U.accountant, role: "accountant" },
    ]),
  );
  const create = makeCreateCatalogItem(db);
  for (const [code, kind, tax, price] of [
    ["CONS", "service", "exempt", "5000"],
    ["PARA", "medicine", "standard", "1500"],
  ] as const) {
    item[code] = ok(
      await create(ctx(U.owner), { kind, code, name: code, taxCategory: tax, priceTtc: price }),
    ).id;
  }
  const receive = makeReceiveStock(db);
  ok(
    await receive(ctx(U.owner), {
      itemId: item.PARA,
      lotNumber: "P-A",
      expiryDate: "2030-01-31",
      quantity: "2",
      unitCost: "600",
    }),
  );
  ok(
    await receive(ctx(U.owner), {
      itemId: item.PARA,
      lotNumber: "P-B",
      expiryDate: "2031-01-31",
      quantity: "10",
      unitCost: "800",
    }),
  );
});

afterAll(async () => {
  await db.$client.end();
});

describe("rapports de ventes et clôture de caisse", () => {
  it("rapport : CA, TVA, avoirs déduits, marge sur le coût réel des lots sortis", async () => {
    // Vente 1 : 1 consultation + 3 paracétamols (2 du lot à 600, 1 du lot à 800), en espèces.
    ok(
      await issue(ctx(U.cashier), {
        lines: [
          { itemId: item.CONS, quantity: "1" },
          { itemId: item.PARA, quantity: "3" },
        ],
        paymentMean: "cash",
      }),
    );
    // Vente 2 : 2 paracétamols (lot à 800), Orange Money, puis annulée.
    const second = ok(
      await issue(ctx(U.cashier), {
        lines: [{ itemId: item.PARA, quantity: "2" }],
        paymentMean: "orange_money",
        paymentReference: "OM-2611-01",
      }),
    );
    ok(await cancel(ctx(U.owner), { invoiceId: second.id, password: "x", reason: "Erreur" }));

    const r = ok(await report(ctx(U.accountant), { from: today, to: today }));
    expect(r).toMatchObject({
      issuerName: "Clinique rapport fictive A",
      invoiceCount: 2,
      creditNoteCount: 1,
      totalTtc: 9_500,
      byMean: { cash: 9_500, orange_money: 0, mtn_momo: 0 },
    });
    expect(r.totalHt + r.totalTax).toBe(r.totalTtc);
    const para = r.items.find((i) => i.code === "PARA");
    // 4 500 TTC → 3 774 HT ; coût 2 × 600 + 1 × 800 = 2 000 ; marge 1 774.
    expect(para).toMatchObject({ quantity: 3, ttc: 4_500, ht: 3_774, cost: 2_000, margin: 1_774 });
    expect(r.items.find((i) => i.code === "CONS")).toMatchObject({ ttc: 5_000, margin: null });
    expect(r.medicineMargin).toBe(1_774);
    expect(await report(ctx(U.accountant), { from: today, to: "2020-01-01" })).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
  });

  it("clôture : écart calculé, une seule par jour, jamais pour un jour à venir", async () => {
    expect(await closeDay(ctx(U.accountant), { countedCash: "9500" })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(await closeDay(ctx(U.cashier), { countedCash: "1", day: "2999-01-01" })).toEqual({
      ok: false,
      error: { code: "RULE", reason: "future_day" },
    });
    const c = ok(await closeDay(ctx(U.cashier), { countedCash: "9000", note: "Billet manquant" }));
    expect(c).toMatchObject({ countedCash: 9_000, difference: -500, expected: { cash: 9_500 } });
    expect(await closeDay(ctx(U.cashier), { countedCash: "9500" })).toEqual({
      ok: false,
      error: { code: "RULE", reason: "already_closed" },
    });
    expect(ok(await closings(ctx(U.accountant), {}))).toMatchObject([
      {
        day: today,
        countedCash: 9_000,
        difference: -500,
        note: "Billet manquant",
        invoiceCount: 3,
      },
    ]);
  });

  it("isolation : B ne voit ni les ventes ni les clôtures de A", async () => {
    expect(ok(await report(ctx(U.ownerB, B), { from: today, to: today }))).toMatchObject({
      totalTtc: 0,
      items: [],
    });
    expect(ok(await closings(ctx(U.ownerB, B), {}))).toEqual([]);
  });
});
