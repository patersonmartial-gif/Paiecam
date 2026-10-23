"use client";

import { useActionState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ActionErrorAlert } from "@/components/action-error";
import { Button } from "@/components/ui";
import type { PayrollState } from "@/server/actions/payroll";

type Action = (s: PayrollState, f: FormData) => Promise<PayrollState>;

/** Formulaire d'action de paie : message de succès ou erreur traduite, bouton désactivé pendant l'envoi. */
export function PayrollForm({
  action,
  periodId,
  submit,
  children,
  variant = "primary",
  className,
}: {
  action: Action;
  periodId?: string;
  submit: string;
  children?: ReactNode;
  variant?: "primary" | "secondary";
  className?: string;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState<PayrollState, FormData>(action, undefined);
  return (
    <form action={formAction} className={className}>
      <ActionErrorAlert error={state?.error} ruleNamespace="payroll.errors" />
      {state?.ok && (
        <p className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          {t(`payroll.${state.ok === "validated" ? "validatedMsg" : state.ok}`)}
        </p>
      )}
      {periodId && <input type="hidden" name="periodId" value={periodId} />}
      {children}
      {variant === "primary" ? (
        <div className="max-w-xs">
          <Button disabled={pending}>{pending ? t("common.loading") : submit}</Button>
        </div>
      ) : (
        <button
          disabled={pending}
          className="rounded-md border border-stone-300 px-4 py-2 text-sm font-medium"
        >
          {pending ? t("common.loading") : submit}
        </button>
      )}
    </form>
  );
}
