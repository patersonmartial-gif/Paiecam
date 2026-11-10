"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { ActionErrorAlert } from "@/components/action-error";
import { Field, Select } from "@/components/ui";
import {
  createCatalogItemAction,
  setPriceAction,
  type CatalogState,
} from "@/server/actions/catalog";

export function NewItemForm() {
  const t = useTranslations("catalog");
  const [state, action, pending] = useActionState<CatalogState, FormData>(
    createCatalogItemAction,
    undefined,
  );
  return (
    <form action={action} className="rounded-lg border border-stone-200 bg-white p-4">
      <h2 className="mb-3 font-semibold">{t("new")}</h2>
      <ActionErrorAlert error={state?.error} ruleNamespace="catalog.errors" />
      {state?.ok && (
        <p role="status" className="mb-3 text-sm text-green-700">
          {t("created")}
        </p>
      )}
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Select label={t("kind")} name="kind" defaultValue="medicine">
          <option value="medicine">{t("kinds.medicine")}</option>
          <option value="service">{t("kinds.service")}</option>
        </Select>
        <Field label={t("code")} name="code" required maxLength={30} hint={t("codeHint")} />
        <Field label={t("name")} name="name" required maxLength={120} />
        <Field label={t("priceTtc")} name="priceTtc" inputMode="numeric" required />
        <Field label={t("form")} name="form" maxLength={60} hint={t("medicineOnly")} />
        <Field label={t("dosage")} name="dosage" maxLength={60} />
        <Field label={t("unit")} name="unit" maxLength={30} />
        <Field label={t("alertThreshold")} name="alertThreshold" inputMode="numeric" />
        <Select label={t("taxCategory")} name="taxCategory" defaultValue="exempt">
          <option value="exempt">{t("tax.exempt")}</option>
          <option value="standard">{t("tax.standard")}</option>
        </Select>
      </div>
      <button
        disabled={pending}
        className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {t("create")}
      </button>
    </form>
  );
}

export function PriceForm({
  id,
  name,
  priceTtc,
}: {
  id: string;
  name: string;
  priceTtc: number | null;
}) {
  const t = useTranslations("catalog");
  const [state, action, pending] = useActionState<CatalogState, FormData>(
    setPriceAction,
    undefined,
  );
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input
        name="priceTtc"
        inputMode="numeric"
        defaultValue={priceTtc ?? ""}
        aria-label={t("priceFor", { name })}
        className="w-28 rounded-md border border-stone-300 px-2 py-1 text-right"
      />
      <button disabled={pending} className="rounded-md border border-stone-300 px-2 py-1 text-xs">
        {t("savePrice")}
      </button>
      {state?.ok === "priceChanged" && (
        <span className="text-xs text-green-700">{t("priceSaved")}</span>
      )}
      <ActionErrorAlert error={state?.error} ruleNamespace="catalog.errors" />
    </form>
  );
}
