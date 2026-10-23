import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui";
import { keyring } from "@/server/crypto";
import { db } from "@/server/db";
import { verifyDocumentCode } from "@/server/features/documents";
import { CompareFile } from "./compare-file";

export const metadata = { robots: { index: false } };

export default async function VerifyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const t = await getTranslations("verify");
  const result =
    code.length <= 40 ? await verifyDocumentCode(db, keyring, decodeURIComponent(code)) : null;
  return (
    <Card title={t("title")}>
      {!result ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-red-800">
          {t("unknown")}
        </p>
      ) : (
        <>
          <p
            className={`mb-4 rounded-md px-3 py-2 font-medium ${result.signatureValid ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}
          >
            {result.signatureValid ? t("authentic") : t("invalidSignature")}
          </p>
          <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-stone-600">{t("issuer")}</dt>
            <dd>{result.issuerName}</dd>
            <dt className="text-stone-600">{t("period")}</dt>
            <dd>
              {String(result.periodMonth).padStart(2, "0")}/{result.periodYear}
            </dd>
            <dt className="text-stone-600">{t("issuedAt")}</dt>
            <dd>{result.issuedAt.toISOString().slice(0, 16).replace("T", " ")} UTC</dd>
            <dt className="text-stone-600">{t("fingerprint")}</dt>
            <dd className="break-all font-mono text-xs">{result.sha256}</dd>
          </dl>
          <CompareFile expected={result.sha256} />
        </>
      )}
      <p className="mt-4 text-xs text-stone-500">{t("privacy")}</p>
    </Card>
  );
}
