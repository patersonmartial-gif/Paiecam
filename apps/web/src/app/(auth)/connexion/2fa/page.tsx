"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Alert, Button, Card, Field } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { authErrorKey } from "@/lib/auth-errors";

export default function VerifyTwoFactorPage() {
  const t = useTranslations();
  const [backup, setBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const code = String(new FormData(e.currentTarget).get("code")).replace(/\s/g, "");
    const { error } = backup
      ? await authClient.twoFactor.verifyBackupCode({ code })
      : await authClient.twoFactor.verifyTotp({ code });
    if (error) {
      setError(authErrorKey(error));
      setPending(false);
      return;
    }
    window.location.href = "/tableau-de-bord";
  }

  return (
    <Card title={t("twoFactor.verifyTitle")}>
      {error && <Alert>{t(error)}</Alert>}
      <p className="mb-4 text-sm text-stone-600">{t("twoFactor.verifyHelp")}</p>
      <form onSubmit={onSubmit}>
        <Field
          label={backup ? t("twoFactor.backupCode") : t("twoFactor.code")}
          name="code"
          inputMode={backup ? "text" : "numeric"}
          autoComplete="one-time-code"
          autoFocus
          required
        />
        <Button disabled={pending}>{pending ? t("common.loading") : t("common.submit")}</Button>
      </form>
      <button
        className="mt-4 w-full text-center text-sm text-brand underline"
        onClick={() => setBackup(!backup)}
      >
        {backup ? t("twoFactor.useTotp") : t("twoFactor.useBackupCode")}
      </button>
    </Card>
  );
}
