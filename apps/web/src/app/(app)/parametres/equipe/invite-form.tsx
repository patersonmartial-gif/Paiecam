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
      {state?.ok && !state.link && (
        <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          {t("team.invited")}
        </p>
      )}
      {state?.link && (
        <div role="status" className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-900">
          <p className="mb-2">{t("team.inviteLinkHelp")}</p>
          <input
            readOnly
            aria-label={t("team.inviteLink")}
            value={state.link}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full rounded border border-green-300 bg-white px-2 py-1 font-mono text-xs"
          />
        </div>
      )}
      <Field label={t("team.email")} name="email" type="email" required />
      <Select label={t("team.role")} name="role" defaultValue="accountant">
        <option value="accountant">{t("tenants.roles.accountant")}</option>
        <option value="payroll_manager">{t("tenants.roles.payroll_manager")}</option>
        <option value="cashier">{t("tenants.roles.cashier")}</option>
        <option value="stock_manager">{t("tenants.roles.stock_manager")}</option>
      </Select>
      <Button disabled={pending}>{pending ? t("common.loading") : t("team.invite")}</Button>
    </form>
  );
}
