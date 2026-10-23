"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Alert, Button, Card, Field } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { authErrorKey } from "@/lib/auth-errors";

export default function SignInPage() {
  const t = useTranslations();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const { data, error } = await authClient.signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    if (error) {
      setError(authErrorKey(error));
      setPending(false);
      return;
    }
    // Avec la 2FA active, le plugin redirige lui-même vers /connexion/2fa.
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) return;
    window.location.href = "/tableau-de-bord";
  }

  return (
    <Card title={t("auth.signInTitle")}>
      {error && <Alert>{t(error)}</Alert>}
      <form onSubmit={onSubmit}>
        <Field label={t("auth.email")} name="email" type="email" autoComplete="email" required />
        <Field
          label={t("auth.password")}
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <Button disabled={pending}>{pending ? t("common.loading") : t("auth.signIn")}</Button>
      </form>
      <p className="mt-4 text-center text-sm">
        {t("auth.noAccount")}{" "}
        <a className="text-brand underline" href="/inscription">
          {t("home.signUp")}
        </a>
      </p>
    </Card>
  );
}
