"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { ActionErrorAlert } from "@/components/action-error";
import { CompanyFields, type CompanyDefaults } from "@/components/company-fields";
import { Button } from "@/components/ui";
import { updateCompanyAction, type SettingsState } from "@/server/actions/settings";

export function CompanySettingsForm({
  defaults,
  canEdit,
}: {
  defaults: CompanyDefaults;
  canEdit: boolean;
}) {
  const t = useTranslations();
  const [state, action, pending] = useActionState<SettingsState, FormData>(
    updateCompanyAction,
    undefined,
  );
  const error = state?.error;
  return (
    <form action={action}>
      <ActionErrorAlert error={error} />
      {state?.ok && (
        <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          {t("settings.saved")}
        </p>
      )}
      {!canEdit && <p className="mb-4 text-sm text-stone-600">{t("settings.readOnly")}</p>}
      <CompanyFields
        defaults={defaults}
        fields={error?.code === "INVALID_INPUT" ? error.fields : {}}
        disabled={!canEdit}
      />
      {canEdit && (
        <Button disabled={pending}>{pending ? t("common.loading") : t("settings.save")}</Button>
      )}
    </form>
  );
}
