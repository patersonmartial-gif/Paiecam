"use client";

import { useTranslations } from "next-intl";
import { Field, Select } from "@/components/ui";

export interface CompanyDefaults {
  legalName?: string;
  niu?: string;
  cnpsEmployerNumber?: string;
  regime?: string;
  workAccidentRate?: number;
  commune?: string;
}

export function CompanyFields({
  defaults = {},
  fields = {},
  disabled = false,
}: {
  defaults?: CompanyDefaults;
  fields?: Record<string, string[]>;
  disabled?: boolean;
}) {
  const t = useTranslations("company");
  return (
    <fieldset disabled={disabled}>
      <Field
        label={t("legalName")}
        name="legalName"
        defaultValue={defaults.legalName}
        required
        error={fields.legalName}
      />
      <Field label={t("niu")} name="niu" defaultValue={defaults.niu} required error={fields.niu} />
      <Field
        label={t("cnpsEmployerNumber")}
        name="cnpsEmployerNumber"
        defaultValue={defaults.cnpsEmployerNumber}
        required
        error={fields.cnpsEmployerNumber}
      />
      <Select label={t("regime")} name="regime" defaultValue={defaults.regime ?? "general"}>
        <option value="general">{t("regimes.general")}</option>
        <option value="agricole">{t("regimes.agricole")}</option>
        <option value="enseignement_prive">{t("regimes.enseignement_prive")}</option>
      </Select>
      <Select
        label={t("workAccidentRate")}
        name="workAccidentRate"
        defaultValue={String(defaults.workAccidentRate ?? 175)}
      >
        <option value="175">1,75 %</option>
        <option value="250">2,5 %</option>
        <option value="500">5 %</option>
      </Select>
      <Field
        label={t("commune")}
        name="commune"
        defaultValue={defaults.commune}
        required
        error={fields.commune}
      />
    </fieldset>
  );
}
