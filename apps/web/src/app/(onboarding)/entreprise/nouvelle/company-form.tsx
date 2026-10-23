"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { ActionErrorAlert } from "@/components/action-error";
import { CompanyFields } from "@/components/company-fields";
import { Button } from "@/components/ui";
import { createCompanyAction, type FormState } from "@/server/actions/company";

export function CompanyForm() {
  const t = useTranslations();
  const [state, action, pending] = useActionState<FormState, FormData>(
    createCompanyAction,
    undefined,
  );
  const error = state?.error;
  return (
    <form action={action}>
      <ActionErrorAlert error={error} />
      <CompanyFields fields={error?.code === "INVALID_INPUT" ? error.fields : {}} />
      <Button disabled={pending}>{pending ? t("common.loading") : t("company.create")}</Button>
    </form>
  );
}
