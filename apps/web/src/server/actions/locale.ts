"use server";

import { cookies } from "next/headers";
import { env } from "@/env";
import { isLocale, LOCALE_COOKIE } from "@/i18n/config";

export async function setLocaleAction(form: FormData): Promise<void> {
  const locale = form.get("locale");
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: "/",
    // Lu uniquement côté serveur (next-intl) : aucune raison de l'exposer au JavaScript.
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 365 * 24 * 60 * 60,
  });
}
