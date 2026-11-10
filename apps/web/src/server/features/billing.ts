/**
 * Facturation au comptoir (clinique et pharmacie) : facture payée immédiatement, numérotation
 * continue sans trou, médicaments sortis du stock (FEFO) dans la même transaction. Une facture
 * ne se modifie jamais : on l'annule par un avoir, qui remet le stock dans les mêmes lots.
 * La base l'impose (migration 0028) ; ce module en est l'usage normal.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { and, asc, desc, eq, gte, inArray, lt, schema, sql, type Db, type Tx } from "@paiecam/db";
import { newVerificationCode } from "@paiecam/documents";
import { computeInvoice, type InvoiceTaxLine } from "@paiecam/paie-engine";
import {
  decryptField,
  encryptField,
  signMessage,
  verifySignature,
  type Keyring,
} from "@paiecam/security";
import { createTenantAction, RuleError } from "../authz/action";
import { can } from "../authz/permissions";
import { currentPrices } from "./catalog";
import { loadRules } from "./payroll";
import { todayInDouala } from "./reminders";
import { allocateFefo, type Allocation } from "./stock";

const { invoices, invoiceLines: lines, invoiceCounters: counters, stockMovements } = schema;

export const invoiceNumber = (i: { series: string; year: number; number: number }) =>
  `${i.series}${i.year}-${String(i.number).padStart(6, "0")}`;

/** Message signé : numéro, montant, date et code ; le reçu est vérifiable sans rien révéler d'autre. */
const signedInvoice = (
  tenantId: string,
  num: string,
  totalTtc: number,
  issuedAt: Date,
  code: string,
) => `invoice|${tenantId}|${num}|${totalTtc}|${issuedAt.toISOString()}|${code}`;

const patientCtx = (tenantId: string, invoiceId: string) => ({
  tenantId,
  table: "invoices",
  column: "patient_name",
  rowId: invoiceId,
});

/** Numéro suivant de la série (verrou sur le compteur jusqu'à la fin de la transaction). */
async function nextNumber(tx: Tx, tenantId: string, series: "F" | "A", year: number) {
  const [row] = await tx
    .insert(counters)
    .values({ tenantId, series, year, lastNumber: 1 })
    .onConflictDoUpdate({
      target: [counters.tenantId, counters.series, counters.year],
      set: { lastNumber: sql`${counters.lastNumber} + 1` },
    })
    .returning({ number: counters.lastNumber });
  return row?.number ?? 0;
}

export interface BillingDeps {
  keyring: Keyring;
  /** Facturer avec une règle de TVA en brouillon (pilote) : le reçu le signale. */
  allowDraftRules: boolean;
}

const lineInput = z.object({
  itemId: z.uuid(),
  quantity: z.coerce.number().int().min(1).max(10_000),
});

export function makeIssueInvoice(db: Db, deps: BillingDeps) {
  return createTenantAction(
    db,
    {
      permission: "billing:issue",
      input: z
        .object({
          lines: z.array(lineInput).min(1).max(50),
          paymentMean: z.enum(["cash", "orange_money", "mtn_momo"]),
          paymentReference: z.string().trim().max(40).optional(),
          patientName: z.string().trim().max(120).optional(),
        })
        .refine((v) => v.paymentMean === "cash" || (v.paymentReference ?? "").length >= 4, {
          path: ["paymentReference"],
          message: "référence de paiement exigée",
        }),
      audit: "billing.issue",
    },
    async ({ tx, tenantId, userId, audit }, input) => {
      // Une même référence saisie deux fois : une seule ligne.
      const wanted = new Map<string, number>();
      for (const l of input.lines) wanted.set(l.itemId, (wanted.get(l.itemId) ?? 0) + l.quantity);
      const ids = [...wanted.keys()];
      const catalog = await tx
        .select()
        .from(schema.catalogItems)
        .where(inArray(schema.catalogItems.id, ids));
      const prices = await currentPrices(tx, ids);
      const today = todayInDouala();
      const picked = ids.map((id) => {
        const item = catalog.find((c) => c.id === id);
        if (!item || !item.active) throw new RuleError("item_unavailable");
        const price = prices.get(id)?.priceTtc;
        if (price === undefined) throw new RuleError("no_price");
        return { item, quantity: wanted.get(id) ?? 0, price };
      });

      const computed = computeInvoice(
        picked.map((p) => ({
          label: p.item.name,
          quantity: p.quantity,
          unitPriceTtc: p.price,
          taxCategory: p.item.taxCategory,
        })),
        await loadRules(tx),
        today,
      );
      if (computed.ruleUsed.status !== "validated" && !deps.allowDraftRules)
        throw new RuleError("draft_tax_rule");

      // Médicaments : lots réservés (FEFO) avant tout numéro attribué.
      const allocations = new Map<string, Allocation[]>();
      for (const p of picked) {
        if (p.item.kind === "medicine")
          allocations.set(p.item.id, await allocateFefo(tx, p.item.id, p.quantity, today));
      }

      const [tenant] = await tx
        .select({ legalName: schema.tenants.legalName })
        .from(schema.tenants);
      const id = randomUUID();
      const year = Number(today.slice(0, 4));
      const number = await nextNumber(tx, tenantId, "F", year);
      const issuedAt = new Date();
      const code = newVerificationCode();
      const num = invoiceNumber({ series: "F", year, number });
      await tx.insert(invoices).values({
        id,
        tenantId,
        kind: "invoice",
        series: "F",
        year,
        number,
        patientNameEnc: input.patientName
          ? encryptField(deps.keyring, patientCtx(tenantId, id), input.patientName)
          : null,
        paymentMean: input.paymentMean,
        paymentReference: input.paymentMean === "cash" ? null : (input.paymentReference ?? null),
        issuerName: tenant?.legalName ?? "",
        totalHt: computed.totalHt,
        totalTax: computed.totalTax,
        totalTtc: computed.totalTtc,
        taxes: computed.taxes,
        ruleUsed: computed.ruleUsed,
        verificationCode: code,
        signature: signMessage(
          deps.keyring,
          signedInvoice(tenantId, num, computed.totalTtc, issuedAt, code),
        ),
        issuedAt,
        issuedBy: userId,
      });
      await tx.insert(lines).values(
        picked.map((p, i) => ({
          tenantId,
          invoiceId: id,
          position: i + 1,
          itemId: p.item.id,
          kind: p.item.kind,
          code: p.item.code,
          label: p.item.name,
          quantity: p.quantity,
          unitPriceTtc: p.price,
          taxCategory: p.item.taxCategory,
          totalTtc: p.price * p.quantity,
          lots: allocations.get(p.item.id) ?? [],
        })),
      );
      const moves = [...allocations.values()].flat();
      if (moves.length > 0) {
        await tx.insert(stockMovements).values(
          moves.map((a) => ({
            tenantId,
            lotId: a.lotId,
            kind: "sale" as const,
            quantity: -a.quantity,
            invoiceId: id,
            createdBy: userId,
          })),
        );
      }
      // Montants seulement : ni nom de patient ni contenu de la facture dans l'audit.
      audit({
        entityType: "invoice",
        entityId: id,
        after: { number: num, totalTtc: computed.totalTtc, paymentMean: input.paymentMean },
      });
      return { id, number: num, totalTtc: computed.totalTtc };
    },
  );
}

export function makeCancelInvoice(
  db: Db,
  deps: {
    keyring: Keyring;
    verifyPassword: (userId: string, password: string) => Promise<boolean>;
  },
) {
  return createTenantAction(
    db,
    {
      permission: "billing:cancel",
      input: z.object({
        invoiceId: z.uuid(),
        password: z.string().min(1).max(128),
        reason: z.string().trim().min(3).max(200),
      }),
      audit: "billing.cancel",
    },
    async ({ tx, tenantId, userId, audit }, input) => {
      if (!(await deps.verifyPassword(userId, input.password))) throw new RuleError("bad_password");
      const [original] = await tx
        .select()
        .from(invoices)
        .where(eq(invoices.id, input.invoiceId))
        .for("update");
      if (!original) throw new RuleError("not_found");
      if (original.kind !== "invoice" || original.status !== "issued")
        throw new RuleError("not_cancellable");
      const originalLines = await tx
        .select()
        .from(lines)
        .where(eq(lines.invoiceId, original.id))
        .orderBy(asc(lines.position));

      const id = randomUUID();
      const year = Number(todayInDouala().slice(0, 4));
      const number = await nextNumber(tx, tenantId, "A", year);
      const issuedAt = new Date();
      const code = newVerificationCode();
      const num = invoiceNumber({ series: "A", year, number });
      const negate = (t: InvoiceTaxLine) => ({
        ...t,
        baseHt: -t.baseHt,
        tax: -t.tax,
        totalTtc: -t.totalTtc,
      });
      await tx.insert(invoices).values({
        id,
        tenantId,
        kind: "credit_note",
        series: "A",
        year,
        number,
        creditedInvoiceId: original.id,
        patientNameEnc: original.patientNameEnc
          ? encryptField(
              deps.keyring,
              patientCtx(tenantId, id),
              decryptField(
                deps.keyring,
                patientCtx(tenantId, original.id),
                original.patientNameEnc,
              ),
            )
          : null,
        paymentMean: original.paymentMean,
        paymentReference: original.paymentReference,
        issuerName: original.issuerName,
        totalHt: -original.totalHt,
        totalTax: -original.totalTax,
        totalTtc: -original.totalTtc,
        taxes: (original.taxes as InvoiceTaxLine[]).map(negate),
        ruleUsed: original.ruleUsed,
        verificationCode: code,
        signature: signMessage(
          deps.keyring,
          signedInvoice(tenantId, num, -original.totalTtc, issuedAt, code),
        ),
        issuedAt,
        issuedBy: userId,
      });
      await tx.insert(lines).values(
        originalLines.map((l) => ({
          tenantId,
          invoiceId: id,
          position: l.position,
          itemId: l.itemId,
          kind: l.kind,
          code: l.code,
          label: l.label,
          quantity: -l.quantity,
          unitPriceTtc: l.unitPriceTtc,
          taxCategory: l.taxCategory,
          totalTtc: -l.totalTtc,
          lots: l.lots,
        })),
      );
      // Le stock revient dans les lots d'où il était sorti.
      const back = originalLines.flatMap((l) => (l.lots as Allocation[]) ?? []);
      if (back.length > 0) {
        await tx.insert(stockMovements).values(
          back.map((a) => ({
            tenantId,
            lotId: a.lotId,
            kind: "sale_cancelled" as const,
            quantity: a.quantity,
            invoiceId: id,
            createdBy: userId,
          })),
        );
      }
      await tx
        .update(invoices)
        .set({
          status: "cancelled",
          cancelledAt: issuedAt,
          cancelledBy: userId,
          cancelReason: input.reason,
        })
        .where(eq(invoices.id, original.id));
      audit({
        entityType: "invoice",
        entityId: original.id,
        after: { cancelledBy: num, totalTtc: original.totalTtc },
      });
      return { creditNoteId: id, number: num };
    },
  );
}

const dayBounds = (day: string) => {
  // Journée à Douala (UTC+1, sans heure d'été).
  const start = new Date(`${day}T00:00:00+01:00`);
  return { start, end: new Date(start.getTime() + 86_400_000) };
};

export function makeListInvoices(db: Db) {
  return createTenantAction(
    db,
    {
      permission: "billing:read",
      input: z.object({ day: z.iso.date().optional() }),
      audit: "billing.list",
      skipAudit: true,
    },
    async ({ tx }, input) => {
      const day = input.day ?? todayInDouala();
      const { start, end } = dayBounds(day);
      const rows = await tx
        .select()
        .from(invoices)
        .where(and(gte(invoices.issuedAt, start), lt(invoices.issuedAt, end)))
        .orderBy(desc(invoices.issuedAt), desc(invoices.number));
      const byMean: Record<string, number> = { cash: 0, orange_money: 0, mtn_momo: 0 };
      for (const r of rows) byMean[r.paymentMean] = (byMean[r.paymentMean] ?? 0) + r.totalTtc;
      return {
        day,
        invoices: rows.map((r) => ({
          id: r.id,
          number: invoiceNumber(r),
          kind: r.kind,
          status: r.status,
          totalTtc: r.totalTtc,
          paymentMean: r.paymentMean,
          issuedAt: r.issuedAt,
        })),
        /** Encaissé net (avoirs déduits) par mode de paiement. */
        byMean,
        total: rows.reduce((s, r) => s + r.totalTtc, 0),
      };
    },
  );
}

export function makeGetInvoice(db: Db, keyring: Keyring) {
  return createTenantAction(
    db,
    {
      permission: "billing:read",
      input: z.object({ id: z.uuid() }),
      audit: "billing.read",
      skipAudit: true,
    },
    async ({ tx, tenantId, role }, input) => {
      const [inv] = await tx.select().from(invoices).where(eq(invoices.id, input.id));
      if (!inv) throw new RuleError("not_found");
      const invLines = await tx
        .select()
        .from(lines)
        .where(eq(lines.invoiceId, inv.id))
        .orderBy(asc(lines.position));
      const [creditNote] = await tx
        .select({
          id: invoices.id,
          series: invoices.series,
          year: invoices.year,
          number: invoices.number,
        })
        .from(invoices)
        .where(eq(invoices.creditedInvoiceId, inv.id));
      const [credited] = inv.creditedInvoiceId
        ? await tx
            .select({
              id: invoices.id,
              series: invoices.series,
              year: invoices.year,
              number: invoices.number,
            })
            .from(invoices)
            .where(eq(invoices.id, inv.creditedInvoiceId))
        : [];
      const [tenant] = await tx.select().from(schema.tenants);
      // Nom du patient : visible de qui encaisse, pas du comptable (minimisation).
      const patientName =
        inv.patientNameEnc && can(role, "billing:issue")
          ? decryptField(keyring, patientCtx(tenantId, inv.id), inv.patientNameEnc)
          : null;
      return {
        id: inv.id,
        number: invoiceNumber(inv),
        kind: inv.kind,
        status: inv.status,
        issuedAt: inv.issuedAt,
        paymentMean: inv.paymentMean,
        paymentReference: inv.paymentReference,
        totalHt: inv.totalHt,
        totalTax: inv.totalTax,
        totalTtc: inv.totalTtc,
        taxes: inv.taxes as InvoiceTaxLine[],
        draftTax: (inv.ruleUsed as { status?: string }).status !== "validated",
        verificationCode: inv.verificationCode,
        cancelReason: inv.cancelReason,
        patientName,
        hasPatientName: inv.patientNameEnc !== null,
        creditNote: creditNote ? { id: creditNote.id, number: invoiceNumber(creditNote) } : null,
        credited: credited ? { id: credited.id, number: invoiceNumber(credited) } : null,
        issuer: tenant
          ? { legalName: tenant.legalName, niu: tenant.niu, commune: tenant.commune }
          : null,
        lines: invLines.map((l) => ({
          code: l.code,
          label: l.label,
          kind: l.kind,
          quantity: l.quantity,
          unitPriceTtc: l.unitPriceTtc,
          taxCategory: l.taxCategory,
          totalTtc: l.totalTtc,
          lots: (l.lots as Allocation[]).map((a) => ({
            lotNumber: a.lotNumber,
            expiryDate: a.expiryDate,
            quantity: a.quantity,
          })),
        })),
      };
    },
  );
}

/** Vérification publique d'un reçu par son code : établissement, numéro, date, montant. */
export async function verifyInvoiceCode(db: Db, keyring: Keyring, code: string) {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/.test(normalized)) return null;
  const row = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.invoice_code', ${normalized}, true)`);
    const [r] = await tx
      .select({
        tenantId: invoices.tenantId,
        series: invoices.series,
        year: invoices.year,
        number: invoices.number,
        kind: invoices.kind,
        status: invoices.status,
        totalTtc: invoices.totalTtc,
        issuedAt: invoices.issuedAt,
        signature: invoices.signature,
        issuerName: invoices.issuerName,
      })
      .from(invoices)
      .where(eq(invoices.verificationCode, normalized));
    return r;
  });
  if (!row) return null;
  const num = invoiceNumber(row);
  return {
    issuerName: row.issuerName,
    number: num,
    kind: row.kind,
    status: row.status,
    totalTtc: row.totalTtc,
    issuedAt: row.issuedAt,
    signatureValid: verifySignature(
      keyring,
      signedInvoice(row.tenantId, num, row.totalTtc, row.issuedAt, normalized),
      row.signature,
    ),
  };
}
