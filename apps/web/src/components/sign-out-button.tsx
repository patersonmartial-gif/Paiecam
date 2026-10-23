"use client";

import { useTranslations } from "next-intl";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const t = useTranslations("common");
  return (
    <button
      className="text-sm text-stone-600 underline"
      onClick={async () => {
        await authClient.signOut();
        window.location.href = "/connexion";
      }}
    >
      {t("signOut")}
    </button>
  );
}
