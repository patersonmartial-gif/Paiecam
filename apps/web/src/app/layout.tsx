import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { headers } from "next/headers";
import { getLocale } from "next-intl/server";
import { LocaleSwitcher } from "@/components/locale-switcher";
import "./globals.css";

export const metadata: Metadata = {
  title: "PaieCam",
  description: "La paie camerounaise conforme en 10 minutes par mois",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
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
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
