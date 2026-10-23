"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Alert, Button, Card, Field } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { authErrorKey } from "@/lib/auth-errors";

export default function SignUpPage() {
  const t = useTranslations();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const { error } = await authClient.signUp.email({
      name: String(form.get("name")),
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    if (error) {
      setError(authErrorKey(error));
      setPending(false);
      return;
    }
    window.location.href = "/entreprise/nouvelle";
  }

  return (
    <Card title={t("auth.signUpTitle")}>
      {error && <Alert>{t(error)}</Alert>}
      <form onSubmit={onSubmit}>
        <Field label={t("auth.name")} name="name" autoComplete="name" required />
        <Field label={t("auth.email")} name="email" type="email" autoComplete="email" required />
        <Field
          label={t("auth.password")}
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          hint={t("auth.passwordHint")}
          required
        />
        <Button disabled={pending}>
          {pending ? t("common.loading") : t("auth.createAccount")}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm">
        {t("auth.haveAccount")}{" "}
        <a className="text-brand underline" href="/connexion">
          {t("auth.signIn")}
        </a>
      </p>
    </Card>
  );
}
