"use client";

import { useActionState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ActionErrorAlert } from "@/components/action-error";
import type { DeclarationState } from "@/server/actions/declarations";

type Action = (s: DeclarationState, f: FormData) => Promise<DeclarationState>;

export function DeclarationForm({
  action,
  periodId,
  declarationId,
  submit,
  children,
  className = "flex flex-wrap items-end gap-2",
}: {
  action: Action;
  periodId: string;
  declarationId?: string;
  submit: string;
  children?: ReactNode;
  className?: string;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState<DeclarationState, FormData>(
    action,
    undefined,
  );
  return (
    <div>
      <ActionErrorAlert error={state?.error} ruleNamespace="declarations.errors" />
      <form action={formAction} className={className}>
        <input type="hidden" name="periodId" value={periodId} />
        {declarationId && <input type="hidden" name="declarationId" value={declarationId} />}
        {children}
        <button
          disabled={pending}
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? t("common.loading") : submit}
        </button>
      </form>
    </div>
  );
}

export function SmallField({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="text-xs">
      <span className="mb-0.5 block text-stone-600">{label}</span>
      <input className="w-36 rounded border border-stone-300 px-2 py-1 text-sm" {...props} />
    </label>
  );
}
