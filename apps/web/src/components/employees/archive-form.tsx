"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { ActionErrorAlert } from "@/components/action-error";
import { Field } from "@/components/ui";
import { archiveEmployeeAction, type EmployeeFormState } from "@/server/actions/employees";

export function ArchiveForm({ employeeId }: { employeeId: string }) {
  const t = useTranslations("employees");
  const [state, action, pending] = useActionState<EmployeeFormState, FormData>(
    archiveEmployeeAction,
    undefined,
  );
  return (
    <form action={action} className="max-w-md rounded-lg border border-red-200 p-4">
      <h2 className="mb-1 font-semibold">{t("sections.archive")}</h2>
      <p className="mb-3 text-sm text-stone-600">{t("archiveHelp")}</p>
      <ActionErrorAlert error={state?.error} ruleNamespace="employees.errors" />
      <input type="hidden" name="id" value={employeeId} />
      <Field label={t("fields.endDate")} name="endDate" type="date" required />
      <button
        disabled={pending}
        className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700"
      >
        {t("archiveButton")}
      </button>
    </form>
  );
}
