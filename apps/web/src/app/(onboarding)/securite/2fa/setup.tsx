"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import QRCode from "qrcode";
import { Alert, Button, Field } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { useHydrated } from "@/lib/use-hydrated";
import { authErrorKey } from "@/lib/auth-errors";

type Step =
  { kind: "password" } | { kind: "scan"; qr: string; secret: string; backupCodes: string[] };

export function TwoFactorSetup() {
  const t = useTranslations();
  const [step, setStep] = useState<Step>({ kind: "password" });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const hydrated = useHydrated();

  async function start(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const password = String(new FormData(e.currentTarget).get("password"));
    const { data, error } = await authClient.twoFactor.enable({ password });
    setPending(false);
    if (error || !data || data.method !== "totp") return setError(authErrorKey(error));
    const secret = new URL(data.totpURI).searchParams.get("secret") ?? "";
    setStep({
      kind: "scan",
      qr: await QRCode.toDataURL(data.totpURI, { margin: 1, width: 220 }),
      secret,
      backupCodes: data.backupCodes,
    });
  }

  async function verify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const code = String(new FormData(e.currentTarget).get("code")).replace(/\s/g, "");
    const { error } = await authClient.twoFactor.verifyTotp({ code });
    if (error) {
      setPending(false);
      return setError(authErrorKey(error));
    }
    window.location.href = "/tableau-de-bord";
  }

  if (step.kind === "password") {
    return (
      <form method="post" onSubmit={start}>
        {error && <Alert>{t(error)}</Alert>}
        <Field
          label={t("twoFactor.confirmPassword")}
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <Button disabled={pending || !hydrated}>
          {pending ? t("common.loading") : t("twoFactor.start")}
        </Button>
      </form>
    );
  }

  return (
    <div>
      {error && <Alert>{t(error)}</Alert>}
      <p className="mb-3 text-sm">{t("twoFactor.scan")}</p>
      <img src={step.qr} alt="QR code" width={220} height={220} className="mx-auto mb-3" />
      <p className="mb-4 text-xs text-stone-600">
        {t("twoFactor.manualKey")} <code className="break-all">{step.secret}</code>
      </p>
      <h2 className="mb-1 text-sm font-semibold">{t("twoFactor.backupCodesTitle")}</h2>
      <p className="mb-2 text-xs text-stone-600">{t("twoFactor.backupCodesHelp")}</p>
      <ul className="mb-4 grid grid-cols-2 gap-1 rounded-md bg-stone-100 p-3 font-mono text-sm">
        {step.backupCodes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <form method="post" onSubmit={verify}>
        <Field
          label={t("twoFactor.code")}
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
        />
        <Button disabled={pending || !hydrated}>
          {pending ? t("common.loading") : t("twoFactor.activate")}
        </Button>
      </form>
    </div>
  );
}
