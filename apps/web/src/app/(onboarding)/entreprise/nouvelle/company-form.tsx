"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Alert, Button, Field, Select } from "@/components/ui";
import { createCompanyAction, type FormState } from "@/server/actions/company";

export function CompanyForm() {
  const t = useTranslations();
  const [state, action, pending] = useActionState<FormState, FormData>(
    createCompanyAction,
    undefined,
  );
  const error = state?.error;
  const fields = error?.code === "INVALID_INPUT" ? error.fields : {};

  return (
    <form action={action}>
      {error && (
        <Alert>
          {error.code === "CONFLICT"
            ? t("company.niuTaken")
            : error.code === "INVALID_INPUT"
              ? t("common.errors.invalidInput")
              : t("common.errors.generic")}
        </Alert>
      )}
      <Field label={t("company.legalName")} name="legalName" required error={fields.legalName} />
      <Field label={t("company.niu")} name="niu" required error={fields.niu} />
      <Field
        label={t("company.cnpsEmployerNumber")}
        name="cnpsEmployerNumber"
        required
        error={fields.cnpsEmployerNumber}
      />
      <Select label={t("company.regime")} name="regime" defaultValue="general">
        <option value="general">{t("company.regimes.general")}</option>
        <option value="agricole">{t("company.regimes.agricole")}</option>
        <option value="enseignement_prive">{t("company.regimes.enseignement_prive")}</option>
      </Select>
      <Select label={t("company.workAccidentRate")} name="workAccidentRate" defaultValue="175">
        <option value="175">1,75 %</option>
        <option value="250">2,5 %</option>
        <option value="500">5 %</option>
      </Select>
      <Field label={t("company.commune")} name="commune" required error={fields.commune} />
      <Button disabled={pending}>{pending ? t("common.loading") : t("company.create")}</Button>
    </form>
  );
}
