"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { ActionErrorAlert } from "@/components/action-error";
import { Button, Field, Select } from "@/components/ui";
import {
  revealSensitiveAction,
  updateBankAction,
  type EmployeeFormState,
  type RevealState,
} from "@/server/actions/employees";

export interface BankView {
  ibanMasked: string | null;
  mobileOperator: "orange" | "mtn" | null;
  mobileNumberMasked: string | null;
}

export function BankSection({
  employeeId,
  bank,
  cnpsMasked,
  canWrite,
  canReveal,
}: {
  employeeId: string;
  bank: BankView;
  cnpsMasked: string | null;
  canWrite: boolean;
  canReveal: boolean;
}) {
  const t = useTranslations("employees");
  const tc = useTranslations("common");
  const [revealed, reveal, revealing] = useActionState<RevealState, FormData>(
    revealSensitiveAction,
    undefined,
  );
  const [saved, save, saving] = useActionState<EmployeeFormState, FormData>(
    updateBankAction,
    undefined,
  );
  const r = revealed?.data;
  const show = (clear: string | null | undefined, maskedValue: string | null) =>
    clear ?? maskedValue ?? t("notSet");

  return (
    <section>
      <h2 className="mb-2 font-semibold">{t("sections.bank")}</h2>
      <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-stone-600">{t("fields.cnpsNumber")}</dt>
        <dd className="font-mono">{show(r?.cnpsNumber, cnpsMasked)}</dd>
        <dt className="text-stone-600">{t("fields.iban")}</dt>
        <dd className="font-mono">{show(r?.iban, bank.ibanMasked)}</dd>
        <dt className="text-stone-600">{t("fields.mobileNumber")}</dt>
        <dd className="font-mono">
          {show(r?.mobileNumber, bank.mobileNumberMasked)}
          {bank.mobileOperator && ` (${t(`operators.${bank.mobileOperator}`)})`}
        </dd>
      </dl>
      {canReveal && !r && (
        <form action={reveal} className="mb-6">
          <input type="hidden" name="id" value={employeeId} />
          <ActionErrorAlert error={revealed?.error} ruleNamespace="employees.errors" />
          <button className="text-sm text-brand underline" disabled={revealing}>
            {t("reveal")}
          </button>
          <p className="text-xs text-stone-500">{t("revealHelp")}</p>
        </form>
      )}
      {canWrite && (
        <form action={save} className="max-w-md rounded-lg border border-stone-200 p-4">
          <ActionErrorAlert error={saved?.error} ruleNamespace="employees.errors" />
          {saved?.ok && (
            <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
              {t("saved")}
            </p>
          )}
          <input type="hidden" name="id" value={employeeId} />
          <Field
            label={t("fields.iban")}
            name="iban"
            placeholder={bank.ibanMasked ?? ""}
            autoComplete="off"
          />
          <Select
            label={t("fields.mobileOperator")}
            name="mobileOperator"
            defaultValue={bank.mobileOperator ?? ""}
          >
            <option value="">{t("operators.none")}</option>
            <option value="orange">{t("operators.orange")}</option>
            <option value="mtn">{t("operators.mtn")}</option>
          </Select>
          <Field
            label={t("fields.mobileNumber")}
            name="mobileNumber"
            placeholder={bank.mobileNumberMasked ?? ""}
            autoComplete="off"
          />
          <Field
            label={t("fields.password")}
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
          <Button disabled={saving}>{saving ? tc("loading") : t("saveBank")}</Button>
        </form>
      )}
    </section>
  );
}
