import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { LocaleSwitcher } from "@/components/locale-switcher";
import "./globals.css";

export const metadata: Metadata = {
  title: "PaieCam",
  description: "La paie camerounaise conforme en 10 minutes par mois",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
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
