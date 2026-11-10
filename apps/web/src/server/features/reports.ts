/**
 * Clôture de caisse et rapports de ventes. Les chiffres viennent des factures et avoirs émis
 * (figés) : un rapport refait plus tard donne le même résultat.
 */
import { z } from "zod";
import { and, asc, desc, eq, gte, inArray, lt, schema, type Db, type Tx } from "@paiecam/db";
import { mulDiv, type InvoiceTaxLine } from "@paiecam/paie-engine";
import { createTenantAction, RuleError } from "../authz/action";
import { todayInDouala } from "./reminders";
import type { Allocation } from "./stock";

const { invoices, invoiceLines: lines, cashClosings: closings } = schema;

/** Journée ou période à Douala (UTC+1, sans heure d'été). */
const startOf = (day: string) => new Date(`${day}T00:00:00+01:00`);
const nextDay = (day: string) => new Date(startOf(day).getTime() + 86_400_000);

async function encashedByMean(tx: Tx, day: string) {
  const rows = await tx
    .select({ mean: invoices.paymentMean, total: invoices.totalTtc })
    .from(invoices)
    .where(and(gte(invoices.issuedAt, startOf(day)), lt(invoices.issuedAt, nextDay(day))));
  const byMean: Record<string, number> = { cash: 0, orange_money: 0, mtn_momo: 0 };
  for (const r of rows) byMean[r.mean] = (byMean[r.mean] ?? 0) + r.total;
  return { byMean, count: rows.length };
}

export function makeCloseDay(db: Db) {
  return createTenantAction(
    db,
    {
      permission: "billing:issue",
      input: z.object({
        day: z.iso.date().optional(),
        countedCash: z.coerce.number().int().min(0).max(1_000_000_000),
        note: z.string().trim().max(300).optional(),
      }),
      audit: "billing.close_day",
    },
    async ({ tx, tenantId, userId, audit }, input) => {
      const today = todayInDouala();
      const day = input.day ?? today;
      if (day > today) throw new RuleError("future_day");
      const [already] = await tx
        .select({ id: closings.id })
        .from(closings)
        .where(eq(closings.day, day));
      if (already) throw new RuleError("already_closed");
      const { byMean, count } = await encashedByMean(tx, day);
      const difference = input.countedCash - (byMean.cash ?? 0);
      const [row] = await tx
        .insert(closings)
        .values({
          tenantId,
          day,
          expected: byMean,
          countedCash: input.countedCash,
          difference,
          invoiceCount: count,
          note: input.note || null,
          closedBy: userId,
        })
        .returning({ id: closings.id });
      audit({
        entityType: "cash_closing",
        entityId: row?.id ?? "",
        after: { day, expectedCash: byMean.cash, countedCash: input.countedCash, difference },
      });
      return { day, expected: byMean, countedCash: input.countedCash, difference };
    },
  );
}

export function makeListClosings(db: Db) {
  return createTenantAction(
    db,
    {
      permission: "billing:read",
      input: z.object({}),
      audit: "billing.closings",
      skipAudit: true,
    },
    async ({ tx }) => tx.select().from(closings).orderBy(desc(closings.day)).limit(31),
  );
}

/** HT d'une ligne : TTC si exonéré, sinon TTC × 10 000 / (10 000 + taux figé sur la facture). */
const lineHt = (totalTtc: number, category: string, taxes: InvoiceTaxLine[]) => {
  const rate = taxes.find((t) => t.category === category)?.rate ?? 0;
  if (rate === 0) return totalTtc;
  const ht = mulDiv([Math.abs(totalTtc), 10_000], 10_000 + rate, "nearest");
  return totalTtc < 0 ? -ht : ht;
};

export function makeSalesReport(db: Db) {
  return createTenantAction(
    db,
    {
      permission: "billing:read",
      input: z
        .object({ from: z.iso.date(), to: z.iso.date() })
        .refine((v) => v.from <= v.to, { path: ["to"], message: "période inversée" }),
      audit: "billing.report",
      skipAudit: true,
    },
    async ({ tx }, input) => {
      const invs = await tx
        .select()
        .from(invoices)
        .where(
          and(
            gte(invoices.issuedAt, startOf(input.from)),
            lt(invoices.issuedAt, nextDay(input.to)),
          ),
        )
        .orderBy(asc(invoices.issuedAt));
      const invLines = invs.length
        ? await tx
            .select()
            .from(lines)
            .where(
              inArray(
                lines.invoiceId,
                invs.map((i) => i.id),
              ),
            )
        : [];
      const lotIds = [
        ...new Set(invLines.flatMap((l) => (l.lots as Allocation[]).map((a) => a.lotId))),
      ];
      const costs = new Map(
        (lotIds.length
          ? await tx
              .select({ id: schema.stockLots.id, unitCost: schema.stockLots.unitCost })
              .from(schema.stockLots)
              .where(inArray(schema.stockLots.id, lotIds))
          : []
        ).map((l) => [l.id, l.unitCost]),
      );
      const taxesOf = new Map(invs.map((i) => [i.id, i.taxes as InvoiceTaxLine[]]));
      const byItem = new Map<
        string,
        {
          code: string;
          label: string;
          kind: string;
          quantity: number;
          ttc: number;
          ht: number;
          cost: number;
        }
      >();
      for (const l of invLines) {
        const sign = l.quantity < 0 ? -1 : 1;
        const cost =
          sign *
          (l.lots as Allocation[]).reduce((s, a) => s + a.quantity * (costs.get(a.lotId) ?? 0), 0);
        const row = byItem.get(l.itemId) ?? {
          code: l.code,
          label: l.label,
          kind: l.kind,
          quantity: 0,
          ttc: 0,
          ht: 0,
          cost: 0,
        };
        row.quantity += l.quantity;
        row.ttc += l.totalTtc;
        row.ht += lineHt(l.totalTtc, l.taxCategory, taxesOf.get(l.invoiceId) ?? []);
        row.cost += cost;
        byItem.set(l.itemId, row);
      }
      const items = [...byItem.values()]
        .map((r) => ({ ...r, margin: r.kind === "medicine" ? r.ht - r.cost : null }))
        .sort((a, b) => b.ttc - a.ttc);
      const byMean: Record<string, number> = { cash: 0, orange_money: 0, mtn_momo: 0 };
      for (const i of invs) byMean[i.paymentMean] = (byMean[i.paymentMean] ?? 0) + i.totalTtc;
      const [tenant] = await tx.select({ name: schema.tenants.legalName }).from(schema.tenants);
      return {
        issuerName: tenant?.name ?? "",
        from: input.from,
        to: input.to,
        invoiceCount: invs.filter((i) => i.kind === "invoice").length,
        creditNoteCount: invs.filter((i) => i.kind === "credit_note").length,
        totalTtc: invs.reduce((s, i) => s + i.totalTtc, 0),
        totalHt: invs.reduce((s, i) => s + i.totalHt, 0),
        totalTax: invs.reduce((s, i) => s + i.totalTax, 0),
        byMean,
        items,
        medicineMargin: items.reduce((s, i) => s + (i.margin ?? 0), 0),
      };
    },
  );
}
