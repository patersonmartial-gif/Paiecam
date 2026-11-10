"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { ActionErrorAlert } from "@/components/action-error";
import { Field } from "@/components/ui";
import { cancelInvoiceAction, type BillingState } from "@/server/actions/billing";

export function CancelForm({ invoiceId }: { invoiceId: string }) {
  const t = useTranslations("billing");
  const [state, action, pending] = useActionState<BillingState, FormData>(
    cancelInvoiceAction,
    undefined,
  );
  return (
    <form action={action} className="max-w-md rounded-lg border border-red-200 bg-white p-4">
      <h2 className="mb-1 font-semibold">{t("cancelTitle")}</h2>
      <p className="mb-3 text-sm text-stone-600">{t("cancelHelp")}</p>
      <ActionErrorAlert error={state?.error} ruleNamespace="billing.errors" />
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <Field label={t("cancelReason")} name="reason" required minLength={3} maxLength={200} />
      <Field
        label={t("password")}
        name="password"
        type="password"
        required
        autoComplete="current-password"
      />
      <button
        disabled={pending}
        className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700"
      >
        {t("cancelButton")}
      </button>
    </form>
  );
}
