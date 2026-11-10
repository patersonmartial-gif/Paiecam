/**
 * Stock des médicaments, par lot et date de péremption. La quantité d'un lot ne change que par un
 * mouvement inscrit au registre (la base l'impose : migration 0026) ; les ventes sortent d'abord
 * les lots qui périment le plus tôt (FEFO), jamais un lot périmé.
 */
import { z } from "zod";
import { and, asc, desc, eq, gt, gte, schema, sql, type Db, type Tx } from "@paiecam/db";
import { createTenantAction, RuleError } from "../authz/action";
import { todayInDouala } from "./reminders";

const { stockLots: lots, stockMovements: movements, catalogItems: items } = schema;

const DAY = 86_400_000;
const addDays = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

export interface Allocation {
  lotId: string;
  lotNumber: string;
  expiryDate: string;
  quantity: number;
}

/**
 * Lots à sortir pour une vente : péremption la plus proche d'abord, lots périmés exclus. Les lots
 * sont verrouillés jusqu'à la fin de la transaction (deux caisses ne vendent pas le même stock).
 */
export async function allocateFefo(
  tx: Tx,
  itemId: string,
  quantity: number,
  today = todayInDouala(),
): Promise<Allocation[]> {
  const available = await tx
    .select({
      id: lots.id,
      lotNumber: lots.lotNumber,
      expiryDate: lots.expiryDate,
      onHand: lots.quantityOnHand,
    })
    .from(lots)
    .where(and(eq(lots.itemId, itemId), gt(lots.quantityOnHand, 0), gte(lots.expiryDate, today)))
    .orderBy(asc(lots.expiryDate), asc(lots.receivedAt), asc(lots.id))
    .for("update");
  const out: Allocation[] = [];
  let rest = quantity;
  for (const l of available) {
    if (rest === 0) break;
    const take = Math.min(rest, l.onHand);
    out.push({ lotId: l.id, lotNumber: l.lotNumber, expiryDate: l.expiryDate, quantity: take });
    rest -= take;
  }
  if (rest > 0) throw new RuleError("insufficient_stock");
  return out;
}

async function findMedicine(tx: Tx, itemId: string) {
  const [item] = await tx.select().from(items).where(eq(items.id, itemId));
  if (!item || item.kind !== "medicine") throw new RuleError("not_found");
  return item;
}

/** Vue d'ensemble : disponible (non périmé), périmé à retirer, valeur, alertes. */
export function makeStockOverview(db: Db) {
  return createTenantAction(
    db,
    {
      permission: "stock:read",
      input: z.object({ today: z.iso.date().optional() }),
      audit: "stock.overview",
      skipAudit: true,
    },
    async ({ tx }, input) => {
      const today = input.today ?? todayInDouala();
      const [tenant] = await tx
        .select({ expiryAlertDays: schema.tenants.expiryAlertDays })
        .from(schema.tenants);
      const alertDays = tenant?.expiryAlertDays ?? 90;
      const soon = addDays(today, alertDays);
      const medicines = await tx
        .select()
        .from(items)
        .where(eq(items.kind, "medicine"))
        .orderBy(asc(items.name));
      const rows = await tx
        .select({
          itemId: lots.itemId,
          available: sql<number>`coalesce(sum(${lots.quantityOnHand}) filter (where ${lots.expiryDate} >= ${today}), 0)::int`,
          expired: sql<number>`coalesce(sum(${lots.quantityOnHand}) filter (where ${lots.expiryDate} < ${today}), 0)::int`,
          expiringSoon: sql<number>`coalesce(sum(${lots.quantityOnHand}) filter (where ${lots.expiryDate} >= ${today} and ${lots.expiryDate} <= ${soon}), 0)::int`,
          nextExpiry: sql<
            string | null
          >`min(${lots.expiryDate}) filter (where ${lots.quantityOnHand} > 0 and ${lots.expiryDate} >= ${today})`,
          value: sql<number>`coalesce(sum(${lots.quantityOnHand}::bigint * ${lots.unitCost}) filter (where ${lots.expiryDate} >= ${today}), 0)::bigint`,
        })
        .from(lots)
        .groupBy(lots.itemId);
      const byItem = new Map(rows.map((r) => [r.itemId, r]));
      const list = medicines.map((m) => {
        const r = byItem.get(m.id);
        const available = r?.available ?? 0;
        return {
          id: m.id,
          code: m.code,
          name: m.name,
          unit: m.unit,
          active: m.active,
          alertThreshold: m.alertThreshold,
          available,
          expired: r?.expired ?? 0,
          expiringSoon: r?.expiringSoon ?? 0,
          nextExpiry: r?.nextExpiry ?? null,
          value: Number(r?.value ?? 0),
          alerts: [
            ...(available === 0
              ? ["out_of_stock"]
              : available <= m.alertThreshold
                ? ["low_stock"]
                : []),
            ...((r?.expiringSoon ?? 0) > 0 ? ["expiring_soon"] : []),
            ...((r?.expired ?? 0) > 0 ? ["expired_on_hand"] : []),
          ],
        };
      });
      return {
        today,
        alertDays,
        medicines: list,
        totalValue: list.reduce((s, m) => s + m.value, 0),
      };
    },
  );
}

/** Lots et derniers mouvements d'un médicament. */
export function makeItemStock(db: Db) {
  return createTenantAction(
    db,
    {
      permission: "stock:read",
      input: z.object({ itemId: z.uuid() }),
      audit: "stock.item",
      skipAudit: true,
    },
    async ({ tx }, input) => {
      const item = await findMedicine(tx, input.itemId);
      const itemLots = await tx
        .select()
        .from(lots)
        .where(eq(lots.itemId, item.id))
        .orderBy(asc(lots.expiryDate), asc(lots.receivedAt));
      const history = await tx
        .select({
          id: movements.id,
          kind: movements.kind,
          quantity: movements.quantity,
          reason: movements.reason,
          createdAt: movements.createdAt,
          lotNumber: lots.lotNumber,
        })
        .from(movements)
        .innerJoin(lots, eq(lots.id, movements.lotId))
        .where(eq(lots.itemId, item.id))
        .orderBy(desc(movements.createdAt), desc(movements.id))
        .limit(50);
      return {
        item: { id: item.id, code: item.code, name: item.name, unit: item.unit },
        lots: itemLots.map((l) => ({
          id: l.id,
          lotNumber: l.lotNumber,
          expiryDate: l.expiryDate,
          quantityOnHand: l.quantityOnHand,
          unitCost: l.unitCost,
          supplier: l.supplier,
          receivedAt: l.receivedAt,
        })),
        history,
      };
    },
  );
}

/** Réception d'une livraison : un lot (créé ou complété) et un mouvement d'entrée. */
export function makeReceiveStock(db: Db) {
  return createTenantAction(
    db,
    {
      permission: "stock:manage",
      input: z.object({
        itemId: z.uuid(),
        lotNumber: z.string().trim().min(1).max(40),
        expiryDate: z.iso.date(),
        quantity: z.coerce.number().int().min(1).max(1_000_000),
        unitCost: z.coerce.number().int().min(0).max(100_000_000),
        supplier: z.string().trim().max(120).optional(),
      }),
      audit: "stock.receive",
    },
    async ({ tx, tenantId, userId, audit }, input) => {
      const item = await findMedicine(tx, input.itemId);
      if (input.expiryDate <= todayInDouala()) throw new RuleError("already_expired");
      let [lot] = await tx
        .select({ id: lots.id, unitCost: lots.unitCost })
        .from(lots)
        .where(
          and(
            eq(lots.itemId, item.id),
            eq(lots.lotNumber, input.lotNumber),
            eq(lots.expiryDate, input.expiryDate),
          ),
        );
      if (lot && lot.unitCost !== input.unitCost) throw new RuleError("lot_cost_mismatch");
      if (!lot) {
        [lot] = await tx
          .insert(lots)
          .values({
            tenantId,
            itemId: item.id,
            lotNumber: input.lotNumber,
            expiryDate: input.expiryDate,
            unitCost: input.unitCost,
            supplier: input.supplier || null,
            receivedBy: userId,
          })
          .returning({ id: lots.id, unitCost: lots.unitCost });
      }
      const lotId = lot?.id ?? "";
      await tx.insert(movements).values({
        tenantId,
        lotId,
        kind: "reception",
        quantity: input.quantity,
        createdBy: userId,
      });
      audit({
        entityType: "stock_lot",
        entityId: lotId,
        after: { itemId: item.id, quantity: input.quantity, expiryDate: input.expiryDate },
      });
      return { lotId };
    },
  );
}

/**
 * Sortie hors vente (casse, périmés) ou correction d'inventaire (quantité comptée). Motif exigé.
 */
export function makeStockAdjustment(db: Db) {
  return createTenantAction(
    db,
    {
      permission: "stock:manage",
      input: z.object({
        lotId: z.uuid(),
        kind: z.enum(["breakage", "expired", "inventory"]),
        /** Casse et périmés : quantité sortie ; inventaire : quantité comptée. */
        quantity: z.coerce.number().int().min(0).max(1_000_000),
        reason: z.string().trim().min(3).max(200),
      }),
      audit: "stock.adjust",
    },
    async ({ tx, tenantId, userId, audit }, input) => {
      const [lot] = await tx.select().from(lots).where(eq(lots.id, input.lotId)).for("update");
      if (!lot) throw new RuleError("not_found");
      const delta =
        input.kind === "inventory" ? input.quantity - lot.quantityOnHand : -input.quantity;
      if (delta === 0) return { lotId: lot.id, delta };
      if (input.kind !== "inventory" && input.quantity > lot.quantityOnHand)
        throw new RuleError("insufficient_stock");
      await tx.insert(movements).values({
        tenantId,
        lotId: lot.id,
        kind: input.kind,
        quantity: delta,
        reason: input.reason,
        createdBy: userId,
      });
      audit({
        entityType: "stock_lot",
        entityId: lot.id,
        before: { quantity: lot.quantityOnHand },
        after: { kind: input.kind, quantity: lot.quantityOnHand + delta },
      });
      return { lotId: lot.id, delta };
    },
  );
}

/** Délai d'alerte avant péremption, propre à l'établissement. */
export function makeSetExpiryAlertDays(db: Db) {
  return createTenantAction(
    db,
    {
      permission: "tenant:update",
      input: z.object({ days: z.coerce.number().int().min(7).max(730) }),
      audit: "stock.expiry_alert_days",
    },
    async ({ tx, tenantId, audit }, input) => {
      await tx
        .update(schema.tenants)
        .set({ expiryAlertDays: input.days })
        .where(eq(schema.tenants.id, tenantId));
      audit({ entityType: "tenant", entityId: tenantId, after: { expiryAlertDays: input.days } });
      return { days: input.days };
    },
  );
}
