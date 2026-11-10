"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { ActionErrorAlert } from "@/components/action-error";
import { Field, Select } from "@/components/ui";
import {
  adjustStockAction,
  receiveStockAction,
  setExpiryAlertDaysAction,
  type StockState,
} from "@/server/actions/stock";

const submit = "rounded-md bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-60";

export function ReceiveForm({ itemId }: { itemId: string }) {
  const t = useTranslations("stock");
  const [state, action, pending] = useActionState<StockState, FormData>(
    receiveStockAction,
    undefined,
  );
  return (
    <form action={action} className="rounded-lg border border-stone-200 bg-white p-4">
      <h2 className="mb-3 font-semibold">{t("receive")}</h2>
      <ActionErrorAlert error={state?.error} ruleNamespace="stock.errors" />
      {state?.ok && (
        <p role="status" className="mb-3 text-sm text-green-700">
          {t("received")}
        </p>
      )}
      <input type="hidden" name="itemId" value={itemId} />
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field label={t("lotNumber")} name="lotNumber" required maxLength={40} />
        <Field label={t("expiryDate")} name="expiryDate" type="date" required />
        <Field label={t("quantity")} name="quantity" inputMode="numeric" required />
        <Field label={t("unitCost")} name="unitCost" inputMode="numeric" required />
        <Field label={t("supplier")} name="supplier" maxLength={120} />
      </div>
      <button disabled={pending} className={submit}>
        {t("receiveButton")}
      </button>
    </form>
  );
}

export function AdjustForm({
  itemId,
  lots,
}: {
  itemId: string;
  lots: { id: string; label: string }[];
}) {
  const t = useTranslations("stock");
  const [state, action, pending] = useActionState<StockState, FormData>(
    adjustStockAction,
    undefined,
  );
  return (
    <form action={action} className="rounded-lg border border-stone-200 bg-white p-4">
      <h2 className="mb-1 font-semibold">{t("adjust")}</h2>
      <p className="mb-3 text-sm text-stone-600">{t("adjustHelp")}</p>
      <ActionErrorAlert error={state?.error} ruleNamespace="stock.errors" />
      {state?.ok && (
        <p role="status" className="mb-3 text-sm text-green-700">
          {t("adjusted")}
        </p>
      )}
      <input type="hidden" name="itemId" value={itemId} />
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Select label={t("lot")} name="lotId" required>
          {lots.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </Select>
        <Select label={t("adjustKind")} name="kind" defaultValue="breakage">
          <option value="breakage">{t("kinds.breakage")}</option>
          <option value="expired">{t("kinds.expired")}</option>
          <option value="inventory">{t("kinds.inventory")}</option>
        </Select>
        <Field
          label={t("adjustQuantity")}
          name="quantity"
          inputMode="numeric"
          required
          hint={t("adjustQuantityHint")}
        />
        <Field label={t("reason")} name="reason" required minLength={3} maxLength={200} />
      </div>
      <button disabled={pending} className={submit}>
        {t("adjustButton")}
      </button>
    </form>
  );
}

export function ExpiryAlertForm({ days }: { days: number }) {
  const t = useTranslations("stock");
  const [state, action, pending] = useActionState<StockState, FormData>(
    setExpiryAlertDaysAction,
    undefined,
  );
  return (
    <form action={action} className="flex flex-wrap items-end gap-2 text-sm">
      <label>
        <span className="mb-1 block">{t("alertDays")}</span>
        <input
          name="days"
          inputMode="numeric"
          defaultValue={days}
          className="w-24 rounded-md border border-stone-300 px-2 py-1"
        />
      </label>
      <button disabled={pending} className="rounded-md border border-stone-300 px-3 py-1">
        {t("save")}
      </button>
      {state?.ok && <span className="text-green-700">{t("saved")}</span>}
      <ActionErrorAlert error={state?.error} />
    </form>
  );
}
