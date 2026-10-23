import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { headers } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { LocaleSwitcher } from "@/components/locale-switcher";
import "./globals.css";

export const metadata: Metadata = {
  title: "PaieCam",
  description: "La paie camerounaise conforme en 10 minutes par mois",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const t = await getTranslations("legal");
  // Lire les en-têtes rend chaque page dynamique : Next.js peut alors poser sur ses scripts
  // le nonce de la CSP de la requête (une page pré-générée garderait des scripts sans nonce).
  await headers();
  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider>
          <header className="flex items-center justify-between border-b border-stone-200 bg-white px-4 py-3">
            <a href="/" className="font-semibold text-brand">
              PaieCam
            </a>
            <LocaleSwitcher />
          </header>
          {children}
          <footer className="mt-16 flex flex-wrap justify-center gap-4 border-t border-stone-200 px-4 py-6 text-sm text-stone-500">
            <a href="/mentions-legales">{t("mentions")}</a>
            <a href="/confidentialite">{t("privacy")}</a>
            <a href="/conditions">{t("terms")}</a>
          </footer>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
