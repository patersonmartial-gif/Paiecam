"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ActionErrorAlert } from "@/components/action-error";
import { Field } from "@/components/ui";
import { closeDayAction, type ClosingState } from "@/server/actions/billing";

export function CloseForm({ expectedCash }: { expectedCash: number }) {
  const t = useTranslations("closing");
  const nf = new Intl.NumberFormat(useLocale() === "en" ? "en-US" : "fr-FR");
  const [state, action, pending] = useActionState<ClosingState, FormData>(
    closeDayAction,
    undefined,
  );
  if (state?.ok) {
    const d = state.ok.difference;
    return (
      <p
        role="status"
        className={`rounded-md px-3 py-2 ${d === 0 ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-900"}`}
      >
        {t("closed", {
          expected: nf.format(state.ok.expectedCash),
          counted: nf.format(state.ok.countedCash),
          difference: `${d > 0 ? "+" : ""}${nf.format(d)}`,
        })}
      </p>
    );
  }
  return (
    <form action={action} className="max-w-md rounded-lg border border-stone-200 bg-white p-4">
      <p className="mb-3 text-sm">{t("expectedCash", { amount: nf.format(expectedCash) })}</p>
      <ActionErrorAlert error={state?.error} ruleNamespace="closing.errors" />
      <Field label={t("countedCash")} name="countedCash" inputMode="numeric" required />
      <Field label={t("note")} name="note" maxLength={300} />
      <button
        disabled={pending}
        className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {t("close")}
      </button>
    </form>
  );
}
