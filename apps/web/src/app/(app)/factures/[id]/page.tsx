import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { getRequestContext } from "@/server/authz";
import { can } from "@/server/authz/permissions";
import { keyring } from "@/server/crypto";
import { db } from "@/server/db";
import { makeGetInvoice } from "@/server/features/billing";
import { requireMember } from "@/server/guards";
import { CancelForm } from "./cancel-form";

const get = makeGetInvoice(db, keyring);

export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ emise?: string }>;
}) {
  const member = await requireMember();
  const { id } = await params;
  const { emise } = await searchParams;
  const res = await get(await getRequestContext(), { id });
  if (!res.ok) notFound();
  const inv = res.data;
  const t = await getTranslations("billing");
  const format = await getFormatter();
  const money = (n: number) => `${format.number(n)} FCFA`;
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <a href="/factures" className="text-sm text-stone-600 underline">
        ← {t("journalTitle")}
      </a>
      {emise && (
        <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-green-800">
          {t("issued")}
        </p>
      )}
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold">
          {t(inv.kind === "credit_note" ? "creditNote" : "invoice")} {inv.number}
        </h1>
        <span className="rounded bg-stone-100 px-2 text-sm">
          {t(inv.kind === "credit_note" ? "creditNote" : `status.${inv.status}`)}
        </span>
      </div>
      <p className="text-sm text-stone-600">
        {format.dateTime(inv.issuedAt, { dateStyle: "long", timeStyle: "short" })} ·{" "}
        {t(`means.${inv.paymentMean}`)}
        {inv.paymentReference ? ` · ${inv.paymentReference}` : ""}
        {inv.patientName ? ` · ${t("patient")} : ${inv.patientName}` : ""}
      </p>
      {inv.credited && (
        <p className="text-sm">
          {t("cancels")}{" "}
          <a href={`/factures/${inv.credited.id}`} className="underline">
            {inv.credited.number}
          </a>
        </p>
      )}
      {inv.creditNote && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {t("cancelledBy")}{" "}
          <a href={`/factures/${inv.creditNote.id}`} className="underline">
            {inv.creditNote.number}
          </a>{" "}
          — {inv.cancelReason}
        </p>
      )}
      {inv.draftTax && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {t("draftTax")}
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-stone-600">
            <tr>
              <th className="px-3 py-2">{t("designation")}</th>
              <th className="px-3 py-2 text-right">{t("quantity")}</th>
              <th className="px-3 py-2 text-right">{t("unitPrice")}</th>
              <th className="px-3 py-2 text-right">{t("amount")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {inv.lines.map((l, i) => (
              <tr key={i}>
                <td className="px-3 py-2">
                  {l.label}
                  {l.lots.length > 0 && (
                    <span className="block text-xs text-stone-500">
                      {t("lots")} : {l.lots.map((x) => `${x.lotNumber} (${x.quantity})`).join(", ")}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">{l.quantity}</td>
                <td className="px-3 py-2 text-right">{format.number(l.unitPriceTtc)}</td>
                <td className="px-3 py-2 text-right">{format.number(l.totalTtc)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="ml-auto grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
        <dt>{t("totalHt")}</dt>
        <dd className="text-right">{money(inv.totalHt)}</dd>
        <dt>{t("vat")}</dt>
        <dd className="text-right">{money(inv.totalTax)}</dd>
        <dt className="font-semibold">{t("totalTtc")}</dt>
        <dd className="text-right font-semibold">{money(inv.totalTtc)}</dd>
      </dl>
      <p className="text-sm text-stone-600">
        {t("verificationCode")} :{" "}
        <a href={`/recu/${inv.verificationCode}`} className="font-mono underline">
          {inv.verificationCode}
        </a>
      </p>
      <a
        href={`/factures/${inv.id}/recu`}
        className="inline-block rounded-md border border-stone-300 px-4 py-2 text-sm font-medium"
      >
        {t("receipt")}
      </a>
      {inv.kind === "invoice" && inv.status === "issued" && can(member.role, "billing:cancel") && (
        <CancelForm invoiceId={inv.id} />
      )}
    </main>
  );
}
