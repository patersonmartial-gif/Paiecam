"use server";

import { revalidatePath } from "next/cache";
import { getRequestContext } from "../authz";
import type { ActionError } from "../authz/action";
import { db } from "../db";
import { makeCreateCatalogItem, makeSetPrice, makeUpdateCatalogItem } from "../features/catalog";

const create = makeCreateCatalogItem(db);
const setPrice = makeSetPrice(db);
const update = makeUpdateCatalogItem(db);

export type CatalogState = { error?: ActionError; ok?: string } | undefined;

const field = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
const amount = (form: FormData, name: string) => field(form, name).replace(/\s/g, "");

export async function createCatalogItemAction(
  _p: CatalogState,
  form: FormData,
): Promise<CatalogState> {
  const res = await create(await getRequestContext(), {
    kind: field(form, "kind"),
    code: field(form, "code"),
    name: field(form, "name"),
    form: field(form, "form"),
    dosage: field(form, "dosage"),
    unit: field(form, "unit"),
    taxCategory: field(form, "taxCategory"),
    alertThreshold: amount(form, "alertThreshold") || "0",
    priceTtc: amount(form, "priceTtc"),
  });
  if (!res.ok) return { error: res.error };
  revalidatePath("/catalogue");
  return { ok: "created" };
}

export async function setPriceAction(_p: CatalogState, form: FormData): Promise<CatalogState> {
  const res = await setPrice(await getRequestContext(), {
    id: field(form, "id"),
    priceTtc: amount(form, "priceTtc"),
  });
  if (!res.ok) return { error: res.error };
  revalidatePath("/catalogue");
  return { ok: res.data.changed ? "priceChanged" : "priceSame" };
}

export async function toggleCatalogItemAction(form: FormData): Promise<void> {
  const ctx = await getRequestContext();
  await update(ctx, {
    id: field(form, "id"),
    name: field(form, "name"),
    form: field(form, "form"),
    dosage: field(form, "dosage"),
    unit: field(form, "unit"),
    taxCategory: field(form, "taxCategory"),
    alertThreshold: field(form, "alertThreshold") || "0",
    active: field(form, "active") === "1",
  });
  revalidatePath("/catalogue");
}
