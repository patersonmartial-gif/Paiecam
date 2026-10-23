"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

/** Compare un PDF à l'empreinte enregistrée : le fichier est haché dans le navigateur, jamais envoyé. */
export function CompareFile({ expected }: { expected: string }) {
  const t = useTranslations("verify");
  const [match, setMatch] = useState<boolean | null>(null);
  // Champ actif seulement une fois le composant hydraté : avant, un fichier déposé serait ignoré.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{t("compare")}</span>
      <input
        type="file"
        accept="application/pdf"
        disabled={!ready}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
          const hex = [...new Uint8Array(digest)]
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
          setMatch(hex === expected);
        }}
      />
      {match !== null && (
        <span
          role="status"
          className={`mt-2 block font-medium ${match ? "text-green-800" : "text-red-700"}`}
        >
          {match ? t("same") : t("different")}
        </span>
      )}
    </label>
  );
}
