"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { ActionErrorAlert } from "@/components/action-error";
import { Button, Field, Select } from "@/components/ui";
import { inviteAction, type SettingsState } from "@/server/actions/settings";

export function InviteForm() {
  const t = useTranslations();
  const [state, action, pending] = useActionState<SettingsState, FormData>(inviteAction, undefined);
  return (
    <form action={action} className="mt-2">
      <ActionErrorAlert error={state?.error} ruleNamespace="team.errors" />
      {state?.ok && (
        <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          {t("team.invited")}
        </p>
      )}
      <Field label={t("team.email")} name="email" type="email" required />
      <Select label={t("team.role")} name="role" defaultValue="accountant">
        <option value="accountant">{t("tenants.roles.accountant")}</option>
        <option value="payroll_manager">{t("tenants.roles.payroll_manager")}</option>
      </Select>
      <Button disabled={pending}>{pending ? t("common.loading") : t("team.invite")}</Button>
    </form>
  );
}
