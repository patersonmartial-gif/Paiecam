import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import { loadTestRules, testDatabaseUrl } from "@paiecam/db/testing";
import { loadRuleFile } from "@paiecam/paie-engine/rules";
import { parseKeyring } from "@paiecam/security";
import type { RequestContext } from "@/server/authz/action";
import {
  makeCancelInvoice,
  makeGetInvoice,
  makeIssueInvoice,
  makeListInvoices,
  verifyInvoiceCode,
} from "@/server/features/billing";
import { makeCreateCatalogItem } from "@/server/features/catalog";
import { makeItemStock, makeReceiveStock } from "@/server/features/stock";
import { todayInDouala } from "@/server/features/reminders";

const db = createDb(testDatabaseUrl());
const keyring = parseKeyring(`v1:${Buffer.alloc(32, 21).toString("base64")}`);
const PASSWORD = "mot-de-passe-fictif";
const issue = makeIssueInvoice(db, { keyring, allowDraftRules: true });
const issueStrict = makeIssueInvoice(db, { keyring, allowDraftRules: false });
const cancel = makeCancelInvoice(db, { keyring, verifyPassword: async (_u, p) => p === PASSWORD });
const get = makeGetInvoice(db, keyring);
const list = makeListInvoices(db);
const itemStock = makeItemStock(db);

const fake = (n: string): NewTenant => ({
  legalName: `Clinique facture fictive ${n}`,
  niu: `F0000000000${n}`,
  cnpsEmployerNumber: `000-000000-${n}`,
  regime: "general",
  workAccidentRate: 175,
  commune: "Kribi 2e",
});
const U = {
  owner: "bi-owner",
  cashier: "bi-cashier",
  accountant: "bi-accountant",
  ownerB: "bi-owner-b",
};
let A = "";
let B = "";
const item: Record<string, string> = {};
const ctx = (userId: string, tenantId = A): RequestContext => ({
  user: { id: userId, twoFactorEnabled: true },
  tenantId,
  ip: "203.0.113.130",
  userAgent: "vitest",
});
const ok = <T>(r: { ok: true; data: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.data;
};
const rule = (reason: string) => ({ ok: false, error: { code: "RULE", reason } });
const year = todayInDouala().slice(0, 4);
const asA = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(db, { tenantId: A, userId: U.owner }, fn);
async function pgError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as Error & { cause?: Error }).cause?.message ?? (e as Error).message;
  }
  return "aucune erreur";
}
const onHand = async (code: string) =>
  ok(await itemStock(ctx(U.owner), { itemId: item[code] ?? "" })).lots.map((l) => [
    l.lotNumber,
    l.quantityOnHand,
  ]);
const sale = (over: Record<string, unknown> = {}) => ({
  lines: [
    { itemId: item.CONS, quantity: "1" },
    { itemId: item.PARA, quantity: "3" },
  ],
  paymentMean: "cash",
  ...over,
});

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
  await asA((tx) =>
    tx.insert(schema.memberships).values([
      { tenantId: A, userId: U.cashier, role: "cashier" },
      { tenantId: A, userId: U.accountant, role: "accountant" },
    ]),
  );
  const create = makeCreateCatalogItem(db);
  for (const [code, kind, name, tax, price] of [
    ["CONS", "service", "Consultation générale", "exempt", "5000"],
    ["PARA", "medicine", "Paracétamol 500 mg", "standard", "1500"],
    ["AMOX", "medicine", "Amoxicilline 500 mg", "exempt", "2500"],
  ] as const) {
    item[code] = ok(
      await create(ctx(U.owner), { kind, code, name, taxCategory: tax, priceTtc: price }),
    ).id;
  }
  const receive = makeReceiveStock(db);
  for (const [lot, expiry, qty] of [
    ["P-2031", "2031-01-31", "50"],
    ["P-2029", "2029-06-30", "2"],
  ] as const) {
    ok(
      await receive(ctx(U.owner), {
        itemId: item.PARA,
        lotNumber: lot,
        expiryDate: expiry,
        quantity: qty,
        unitCost: "700",
      }),
    );
  }
});

afterAll(async () => {
  await db.$client.end();
});

describe("facturation au comptoir", () => {
  let first = "";

  it("facture : numéro, totaux, stock sorti au plus près de la péremption, patient chiffré", async () => {
    const r = ok(await issue(ctx(U.cashier), sale({ patientName: "Patient Fictif" })));
    first = r.id;
    expect(r.number).toBe(`F${year}-000001`);
    expect(r.totalTtc).toBe(9_500);
    const inv = ok(await get(ctx(U.cashier), { id: r.id }));
    expect(inv).toMatchObject({
      kind: "invoice",
      status: "issued",
      paymentMean: "cash",
      totalTtc: 9_500,
      // 4 500 taxables : 4 500 × 10 000 / 11 925 = 3 773,6 → 3 774 HT ; 5 000 exonérés.
      totalHt: 8_774,
      totalTax: 726,
      patientName: "Patient Fictif",
      draftTax: true,
    });
    expect(inv.lines[1]?.lots).toEqual([
      { lotNumber: "P-2029", expiryDate: "2029-06-30", quantity: 2 },
      { lotNumber: "P-2031", expiryDate: "2031-01-31", quantity: 1 },
    ]);
    expect(await onHand("PARA")).toEqual([
      ["P-2029", 0],
      ["P-2031", 49],
    ]);
    const [raw] = await asA((tx) =>
      tx
        .select({ p: schema.invoices.patientNameEnc })
        .from(schema.invoices)
        .where(eq(schema.invoices.id, r.id)),
    );
    expect(raw?.p).not.toContain("Patient");
    const audit = await asA((tx) =>
      tx
        .select({ after: schema.auditLog.after })
        .from(schema.auditLog)
        .where(eq(schema.auditLog.action, "billing.issue")),
    );
    expect(JSON.stringify(audit)).not.toContain("Patient");
  });

  it("le comptable voit la facture mais pas le nom du patient", async () => {
    const inv = ok(await get(ctx(U.accountant), { id: first }));
    expect(inv).toMatchObject({ patientName: null, hasPatientName: true });
    expect(await issue(ctx(U.accountant), sale())).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });

  it("numérotation continue sous concurrence, aucun numéro perdu sur un échec", async () => {
    // Stock insuffisant : refusé, et le numéro n'est pas consommé.
    expect(
      await issue(ctx(U.cashier), sale({ lines: [{ itemId: item.AMOX, quantity: "1" }] })),
    ).toEqual(rule("insufficient_stock"));
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        issue(ctx(U.cashier), sale({ lines: [{ itemId: item.CONS, quantity: "1" }] })),
      ),
    );
    const numbers = results.map((r) => ok(r).number).sort();
    expect(numbers).toEqual([2, 3, 4, 5, 6].map((n) => `F${year}-${String(n).padStart(6, "0")}`));
  });

  it("mobile money : référence exigée ; règle de TVA en brouillon refusée hors pilote", async () => {
    expect(await issue(ctx(U.cashier), sale({ paymentMean: "orange_money" }))).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
    ok(
      await issue(
        ctx(U.cashier),
        sale({ paymentMean: "mtn_momo", paymentReference: "MP2611.1234" }),
      ),
    );
    expect(await issueStrict(ctx(U.cashier), sale())).toEqual(rule("draft_tax_rule"));
  });

  it("annulation : propriétaire et mot de passe ; avoir numéroté ; stock remis dans les mêmes lots", async () => {
    expect(
      await cancel(ctx(U.cashier), { invoiceId: first, password: PASSWORD, reason: "Erreur" }),
    ).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(
      await cancel(ctx(U.owner), { invoiceId: first, password: "faux", reason: "Erreur" }),
    ).toEqual(rule("bad_password"));
    const c = ok(
      await cancel(ctx(U.owner), {
        invoiceId: first,
        password: PASSWORD,
        reason: "Erreur de saisie",
      }),
    );
    expect(c.number).toBe(`A${year}-000001`);
    const original = ok(await get(ctx(U.owner), { id: first }));
    expect(original).toMatchObject({ status: "cancelled", cancelReason: "Erreur de saisie" });
    expect(original.creditNote?.number).toBe(c.number);
    const note = ok(await get(ctx(U.owner), { id: c.creditNoteId }));
    expect(note).toMatchObject({ kind: "credit_note", totalTtc: -9_500, totalTax: -726 });
    expect(note.credited?.id).toBe(first);
    // Lots d'origine reconstitués (la vente MTN MoMo du test précédent a sorti 3 boîtes du lot 2031).
    expect(await onHand("PARA")).toEqual([
      ["P-2029", 2],
      ["P-2031", 47],
    ]);
    expect(
      await cancel(ctx(U.owner), { invoiceId: first, password: PASSWORD, reason: "Encore" }),
    ).toEqual(rule("not_cancellable"));
    expect(
      await cancel(ctx(U.owner), {
        invoiceId: c.creditNoteId,
        password: PASSWORD,
        reason: "Avoir",
      }),
    ).toEqual(rule("not_cancellable"));
  });

  it("journal du jour : encaissé net par mode de paiement (avoirs déduits)", async () => {
    const day = ok(await list(ctx(U.accountant), {}));
    expect(day.byMean).toEqual({
      cash: 5 * 5_000 + 9_500 - 9_500,
      orange_money: 0,
      mtn_momo: 9_500,
    });
    expect(day.total).toBe(25_000 + 9_500);
    expect(day.invoices.filter((i) => i.kind === "credit_note")).toHaveLength(1);
  });

  it("la base refuse toute falsification d'une facture émise", async () => {
    expect(
      await pgError(
        asA((tx) =>
          tx.update(schema.invoices).set({ totalTtc: 1 }).where(eq(schema.invoices.id, first)),
        ),
      ),
    ).toMatch(/permission denied/);
    expect(
      await pgError(asA((tx) => tx.delete(schema.invoices).where(eq(schema.invoices.id, first)))),
    ).toMatch(/permission denied|ne se supprime pas/);
    expect(
      await pgError(
        asA((tx) =>
          tx.insert(schema.invoiceLines).values({
            tenantId: A,
            invoiceId: first,
            position: 99,
            itemId: item.CONS ?? "",
            kind: "service",
            code: "CONS",
            label: "Ajout frauduleux",
            quantity: 1,
            unitPriceTtc: 1,
            taxCategory: "exempt",
            totalTtc: 1,
          }),
        ),
      ),
    ).toMatch(/ne reçoit plus de ligne/);
    expect(
      await pgError(
        asA((tx) => tx.execute(sql`update invoice_counters set last_number = last_number - 1`)),
      ),
    ).toBe("aucune erreur");
    // Un compteur reculé ne permet pas de réutiliser un numéro (unicité) : l'émission échoue.
    const r = await issue(ctx(U.cashier), sale({ lines: [{ itemId: item.CONS, quantity: "1" }] }));
    expect(r.ok).toBe(false);
  });

  it("vérification publique d'un reçu ; isolation entre entreprises", async () => {
    const inv = ok(await get(ctx(U.owner), { id: first }));
    expect(await verifyInvoiceCode(db, keyring, inv.verificationCode.toLowerCase())).toMatchObject({
      issuerName: "Clinique facture fictive A",
      number: `F${year}-000001`,
      status: "cancelled",
      totalTtc: 9_500,
      signatureValid: true,
    });
    expect(await verifyInvoiceCode(db, keyring, "AAAA-BBBB-CCCC-DDDD")).toBeNull();
    expect(await verifyInvoiceCode(db, keyring, "pas un code")).toBeNull();
    expect(await get(ctx(U.ownerB, B), { id: first })).toEqual(rule("not_found"));
    expect(ok(await list(ctx(U.ownerB, B), {})).invoices).toEqual([]);
    // B ne facture pas un article de A.
    expect(await issue(ctx(U.ownerB, B), sale())).toEqual(rule("item_unavailable"));
  });
});
