"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { ActionErrorAlert } from "@/components/action-error";
import { requestBackupAction, type BackupState } from "@/server/actions/backups";

export function BackupNow() {
  const t = useTranslations("backups");
  const [state, action, pending] = useActionState<BackupState, FormData>(
    requestBackupAction,
    undefined,
  );
  return (
    <form action={action} className="mb-6">
      <ActionErrorAlert error={state?.error} />
      {state?.ok && (
        <p role="status" className="mb-3 text-sm text-green-700">
          {t("requested")}
        </p>
      )}
      <button
        disabled={pending}
        className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {t("now")}
      </button>
    </form>
  );
}
