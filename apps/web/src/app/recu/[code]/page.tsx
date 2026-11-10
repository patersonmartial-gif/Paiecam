import { getFormatter, getTranslations } from "next-intl/server";
import { Card } from "@/components/ui";
import { keyring } from "@/server/crypto";
import { db } from "@/server/db";
import { verifyInvoiceCode } from "@/server/features/billing";

export const metadata = { robots: { index: false } };

/** Vérification publique d'un reçu : établissement, numéro, date, montant ; rien sur le patient. */
export default async function VerifyReceiptPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const t = await getTranslations("billing.verify");
  const format = await getFormatter();
  const result =
    code.length <= 40 ? await verifyInvoiceCode(db, keyring, decodeURIComponent(code)) : null;
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
            {result.signatureValid ? t("authentic") : t("invalid")}
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-stone-600">{t("issuer")}</dt>
            <dd>{result.issuerName}</dd>
            <dt className="text-stone-600">{t("number")}</dt>
            <dd className="font-mono">{result.number}</dd>
            <dt className="text-stone-600">{t("date")}</dt>
            <dd>{format.dateTime(result.issuedAt, { dateStyle: "long", timeStyle: "short" })}</dd>
            <dt className="text-stone-600">{t("amount")}</dt>
            <dd>{format.number(result.totalTtc)} FCFA</dd>
            <dt className="text-stone-600">{t("state")}</dt>
            <dd>
              {t(
                result.status === "cancelled"
                  ? "cancelled"
                  : result.kind === "credit_note"
                    ? "creditNote"
                    : "valid",
              )}
            </dd>
          </dl>
        </>
      )}
    </Card>
  );
}
