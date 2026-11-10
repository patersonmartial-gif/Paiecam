/**
 * Catalogue de l'établissement : prestations et médicaments, prix TTC fixés librement par le
 * propriétaire. Chaque changement de prix ajoute une ligne d'historique : une facture émise garde
 * le prix du jour où elle a été faite.
 */
import { z } from "zod";
import { asc, desc, eq, inArray, schema, type Db, type Tx } from "@paiecam/db";
import { createTenantAction, RuleError } from "../authz/action";

const { catalogItems: items, catalogPrices: prices } = schema;

const price = z.coerce.number().int().min(0).max(100_000_000);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const itemFields = {
  name: z.string().trim().min(1).max(120),
  form: optionalText(60),
  dosage: optionalText(60),
  unit: optionalText(30),
  taxCategory: z.enum(["standard", "exempt"]),
  alertThreshold: z.coerce.number().int().min(0).max(1_000_000).default(0),
};

/** Prix en vigueur de chaque article (dernier prix fixé). */
export async function currentPrices(tx: Tx, itemIds?: string[]) {
  const rows = await tx
    .selectDistinctOn([prices.itemId], {
      itemId: prices.itemId,
      priceTtc: prices.priceTtc,
      validFrom: prices.validFrom,
    })
    .from(prices)
    .where(itemIds ? inArray(prices.itemId, itemIds) : undefined)
    .orderBy(prices.itemId, desc(prices.validFrom), desc(prices.id));
  return new Map(rows.map((r) => [r.itemId, r]));
}

async function findItem(tx: Tx, id: string) {
  const [item] = await tx.select().from(items).where(eq(items.id, id));
  if (!item) throw new RuleError("not_found");
  return item;
}

export function makeListCatalog(db: Db) {
  return createTenantAction(
    db,
    {
      permission: "catalog:read",
      input: z.object({ kind: z.enum(["service", "medicine"]).optional() }),
      audit: "catalog.list",
      skipAudit: true,
    },
    async ({ tx }, input) => {
      const rows = await tx
        .select()
        .from(items)
        .where(input.kind ? eq(items.kind, input.kind) : undefined)
        .orderBy(asc(items.kind), asc(items.name));
      const current = await currentPrices(tx);
      return rows.map((i) => ({
        id: i.id,
        kind: i.kind,
        code: i.code,
        name: i.name,
        form: i.form,
        dosage: i.dosage,
        unit: i.unit,
        taxCategory: i.taxCategory,
        alertThreshold: i.alertThreshold,
        active: i.active,
        priceTtc: current.get(i.id)?.priceTtc ?? null,
        priceSince: current.get(i.id)?.validFrom ?? null,
      }));
    },
  );
}

export function makeCreateCatalogItem(db: Db) {
  return createTenantAction(
    db,
    {
      permission: "catalog:manage",
      input: z.object({
        kind: z.enum(["service", "medicine"]),
        code: z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z0-9][A-Z0-9_-]{0,29}$/),
        priceTtc: price,
        ...itemFields,
      }),
      audit: "catalog.create",
    },
    async ({ tx, tenantId, userId, audit }, input) => {
      const [item] = await tx
        .insert(items)
        .values({
          tenantId,
          kind: input.kind,
          code: input.code,
          name: input.name,
          form: input.form ?? null,
          dosage: input.dosage ?? null,
          unit: input.unit ?? null,
          taxCategory: input.taxCategory,
          alertThreshold: input.alertThreshold,
        })
        .returning({ id: items.id });
      const id = item?.id ?? "";
      await tx
        .insert(prices)
        .values({ tenantId, itemId: id, priceTtc: input.priceTtc, setBy: userId });
      audit({
        entityType: "catalog_item",
        entityId: id,
        after: { kind: input.kind, code: input.code, priceTtc: input.priceTtc },
      });
      return { id };
    },
  );
}

export function makeUpdateCatalogItem(db: Db) {
  return createTenantAction(
    db,
    {
      permission: "catalog:manage",
      input: z.object({ id: z.uuid(), active: z.boolean().optional(), ...itemFields }),
      audit: "catalog.update",
    },
    async ({ tx, audit }, input) => {
      const before = await findItem(tx, input.id);
      await tx
        .update(items)
        .set({
          name: input.name,
          form: input.form ?? null,
          dosage: input.dosage ?? null,
          unit: input.unit ?? null,
          taxCategory: input.taxCategory,
          alertThreshold: input.alertThreshold,
          ...(input.active === undefined ? {} : { active: input.active }),
        })
        .where(eq(items.id, before.id));
      audit({
        entityType: "catalog_item",
        entityId: before.id,
        before: { taxCategory: before.taxCategory, active: before.active },
        after: { taxCategory: input.taxCategory, active: input.active ?? before.active },
      });
      return { id: before.id };
    },
  );
}

/** Nouveau prix, appliqué aux factures émises à partir de maintenant. */
export function makeSetPrice(db: Db) {
  return createTenantAction(
    db,
    {
      permission: "catalog:manage",
      input: z.object({ id: z.uuid(), priceTtc: price }),
      audit: "catalog.set_price",
    },
    async ({ tx, tenantId, userId, audit }, input) => {
      const item = await findItem(tx, input.id);
      const before = (await currentPrices(tx, [item.id])).get(item.id)?.priceTtc ?? null;
      if (before === input.priceTtc) return { id: item.id, changed: false };
      await tx
        .insert(prices)
        .values({ tenantId, itemId: item.id, priceTtc: input.priceTtc, setBy: userId });
      audit({
        entityType: "catalog_item",
        entityId: item.id,
        before: { priceTtc: before },
        after: { priceTtc: input.priceTtc },
      });
      return { id: item.id, changed: true };
    },
  );
}

export function makePriceHistory(db: Db) {
  return createTenantAction(
    db,
    {
      permission: "catalog:read",
      input: z.object({ id: z.uuid() }),
      audit: "catalog.price_history",
      skipAudit: true,
    },
    async ({ tx }, input) => {
      const item = await findItem(tx, input.id);
      return tx
        .select({ priceTtc: prices.priceTtc, validFrom: prices.validFrom })
        .from(prices)
        .where(eq(prices.itemId, item.id))
        .orderBy(desc(prices.validFrom), desc(prices.id));
    },
  );
}
