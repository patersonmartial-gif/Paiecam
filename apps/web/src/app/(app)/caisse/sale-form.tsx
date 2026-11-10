"use client";

import { useActionState, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ActionErrorAlert } from "@/components/action-error";
import { Field, Select } from "@/components/ui";
import { issueInvoiceAction, type BillingState } from "@/server/actions/billing";

export interface SaleItem {
  id: string;
  kind: "service" | "medicine";
  code: string;
  name: string;
  priceTtc: number;
  available: number | null;
}

export function SaleForm({ items }: { items: SaleItem[] }) {
  const t = useTranslations("billing");
  const locale = useLocale();
  const nf = new Intl.NumberFormat(locale === "en" ? "en-US" : "fr-FR");
  const [state, action, pending] = useActionState<BillingState, FormData>(
    issueInvoiceAction,
    undefined,
  );
  const [rows, setRows] = useState([{ key: 0, itemId: "", quantity: "1" }]);
  const [mean, setMean] = useState("cash");
  const priced = new Map(items.map((i) => [i.id, i]));
  const total = rows.reduce((sum, r) => {
    const item = priced.get(r.itemId);
    const q = Number(r.quantity);
    return item && Number.isInteger(q) && q > 0 ? sum + item.priceTtc * q : sum;
  }, 0);
  const update = (key: number, patch: Partial<{ itemId: string; quantity: string }>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <form action={action} className="space-y-4 rounded-lg border border-stone-200 bg-white p-4">
      <ActionErrorAlert error={state?.error} ruleNamespace="billing.errors" />
      <div className="space-y-2">
        {rows.map((r, index) => {
          const item = priced.get(r.itemId);
          return (
            <div key={r.key} className="flex flex-wrap items-end gap-2">
              <label className="min-w-64 flex-1 text-sm">
                <span className="mb-1 block font-medium">{t("article", { n: index + 1 })}</span>
                <select
                  name="itemId"
                  value={r.itemId}
                  onChange={(e) => update(r.key, { itemId: e.target.value })}
                  className="w-full rounded-md border border-stone-300 bg-white px-3 py-2"
                >
                  <option value="">{t("choose")}</option>
                  {(["service", "medicine"] as const).map((kind) => (
                    <optgroup key={kind} label={t(`groups.${kind}`)}>
                      {items
                        .filter((i) => i.kind === kind)
                        .map((i) => (
                          <option key={i.id} value={i.id} disabled={i.available === 0}>
                            {i.name} — {nf.format(i.priceTtc)} FCFA
                            {i.available !== null ? ` (${t("inStock", { n: i.available })})` : ""}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label className="w-24 text-sm">
                <span className="mb-1 block font-medium">{t("quantity")}</span>
                <input
                  name="quantity"
                  inputMode="numeric"
                  value={r.quantity}
                  aria-label={t("quantityOf", { n: index + 1 })}
                  onChange={(e) => update(r.key, { quantity: e.target.value })}
                  className="w-full rounded-md border border-stone-300 px-3 py-2 text-right"
                />
              </label>
              <span className="w-28 py-2 text-right text-sm">
                {item ? `${nf.format(item.priceTtc * (Number(r.quantity) || 0))} FCFA` : ""}
              </span>
              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                  className="py-2 text-sm text-red-700 underline"
                >
                  {t("remove")}
                </button>
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={() =>
            setRows((rs) => [
              ...rs,
              { key: Math.max(...rs.map((x) => x.key)) + 1, itemId: "", quantity: "1" },
            ])
          }
          className="rounded-md border border-stone-300 px-3 py-1 text-sm"
        >
          {t("addLine")}
        </button>
      </div>
      <p className="text-right text-lg font-semibold">
        {t("total")} : {nf.format(total)} FCFA
      </p>
      <div className="grid gap-x-3 sm:grid-cols-3">
        <Select
          label={t("paymentMean")}
          name="paymentMean"
          value={mean}
          onChange={(e) => setMean(e.target.value)}
        >
          <option value="cash">{t("means.cash")}</option>
          <option value="orange_money">{t("means.orange_money")}</option>
          <option value="mtn_momo">{t("means.mtn_momo")}</option>
        </Select>
        {mean !== "cash" && (
          <Field
            label={t("paymentReference")}
            name="paymentReference"
            required
            minLength={4}
            maxLength={40}
          />
        )}
        <Field
          label={t("patientName")}
          name="patientName"
          maxLength={120}
          hint={t("patientHint")}
        />
      </div>
      <button
        disabled={pending || total === 0}
        className="rounded-md bg-brand px-5 py-2 font-medium text-white disabled:opacity-60"
      >
        {t("issue")}
      </button>
    </form>
  );
}
