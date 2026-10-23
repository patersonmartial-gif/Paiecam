"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { ActionErrorAlert } from "@/components/action-error";
import { Button } from "@/components/ui";
import { acceptInvitationAction, type SettingsState } from "@/server/actions/settings";

export function AcceptForm({ token }: { token: string }) {
  const t = useTranslations();
  const [state, action, pending] = useActionState<SettingsState, FormData>(
    acceptInvitationAction,
    undefined,
  );
  return (
    <form action={action}>
      <ActionErrorAlert error={state?.error} ruleNamespace="invitation.errors" />
      <input type="hidden" name="token" value={token} />
      <Button disabled={pending}>{pending ? t("common.loading") : t("invitation.accept")}</Button>
    </form>
  );
}
