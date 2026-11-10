"use server";

import { revalidatePath } from "next/cache";
import { getRequestContext } from "../authz";
import type { ActionError } from "../authz/action";
import { db } from "../db";
import { makeReceiveStock, makeSetExpiryAlertDays, makeStockAdjustment } from "../features/stock";

const receive = makeReceiveStock(db);
const adjust = makeStockAdjustment(db);
const setDays = makeSetExpiryAlertDays(db);

export type StockState = { error?: ActionError; ok?: string } | undefined;

const field = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
const num = (form: FormData, name: string) => field(form, name).replace(/\s/g, "");

export async function receiveStockAction(_p: StockState, form: FormData): Promise<StockState> {
  const itemId = field(form, "itemId");
  const res = await receive(await getRequestContext(), {
    itemId,
    lotNumber: field(form, "lotNumber"),
    expiryDate: field(form, "expiryDate"),
    quantity: num(form, "quantity"),
    unitCost: num(form, "unitCost"),
    supplier: field(form, "supplier"),
  });
  if (!res.ok) return { error: res.error };
  revalidatePath(`/stock/${itemId}`);
  return { ok: "received" };
}

export async function adjustStockAction(_p: StockState, form: FormData): Promise<StockState> {
  const res = await adjust(await getRequestContext(), {
    lotId: field(form, "lotId"),
    kind: field(form, "kind"),
    quantity: num(form, "quantity"),
    reason: field(form, "reason"),
  });
  if (!res.ok) return { error: res.error };
  revalidatePath(`/stock/${field(form, "itemId")}`);
  return { ok: "adjusted" };
}

export async function setExpiryAlertDaysAction(
  _p: StockState,
  form: FormData,
): Promise<StockState> {
  const res = await setDays(await getRequestContext(), { days: num(form, "days") });
  if (!res.ok) return { error: res.error };
  revalidatePath("/stock");
  return { ok: "saved" };
}
