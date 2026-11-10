import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { getRequestContext } from "@/server/authz";
import { db } from "@/server/db";
import { makeListInvoices } from "@/server/features/billing";
import { requireMember } from "@/server/guards";

const list = makeListInvoices(db);

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ jour?: string }>;
}) {
  await requireMember();
  const { jour } = await searchParams;
  const day = jour && /^\d{4}-\d{2}-\d{2}$/.test(jour) ? jour : undefined;
  const res = await list(await getRequestContext(), day ? { day } : {});
  if (!res.ok) notFound();
  const t = await getTranslations("billing");
  const format = await getFormatter();
  const { invoices, byMean, total } = res.data;
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t("journalTitle")}</h1>
          <p className="mt-1 text-sm">
            <a href="/factures/cloture" className="underline">
              {t("closingLink")}
            </a>{" "}
            ·{" "}
            <a href="/rapports" className="underline">
              {t("reportsLink")}
            </a>
          </p>
        </div>
        <form className="flex items-end gap-2 text-sm">
          <label>
            <span className="mb-1 block">{t("day")}</span>
            <input
              type="date"
              name="jour"
              defaultValue={res.data.day}
              className="rounded-md border border-stone-300 px-2 py-1"
            />
          </label>
          <button className="rounded-md border border-stone-300 px-3 py-1">{t("show")}</button>
        </form>
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(["cash", "orange_money", "mtn_momo"] as const).map((m) => (
          <div key={m} className="rounded-lg border border-stone-200 bg-white p-3">
            <dt className="text-xs text-stone-500">{t(`means.${m}`)}</dt>
            <dd className="text-lg font-semibold">{format.number(byMean[m] ?? 0)} FCFA</dd>
          </div>
        ))}
        <div className="rounded-lg border border-brand/40 bg-white p-3">
          <dt className="text-xs text-stone-500">{t("dayTotal")}</dt>
          <dd className="text-lg font-semibold">{format.number(total)} FCFA</dd>
        </div>
      </dl>
      {invoices.length === 0 ? (
        <p className="text-sm text-stone-500">{t("noInvoices")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-stone-600">
              <tr>
                <th className="px-3 py-2">{t("number")}</th>
                <th className="px-3 py-2">{t("time")}</th>
                <th className="px-3 py-2">{t("paymentMean")}</th>
                <th className="px-3 py-2">{t("statusLabel")}</th>
                <th className="px-3 py-2 text-right">{t("amount")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {invoices.map((i) => (
                <tr key={i.id}>
                  <td className="px-3 py-2">
                    <a href={`/factures/${i.id}`} className="font-mono underline">
                      {i.number}
                    </a>
                  </td>
                  <td className="px-3 py-2">
                    {format.dateTime(i.issuedAt, { timeStyle: "short" })}
                  </td>
                  <td className="px-3 py-2">{t(`means.${i.paymentMean}`)}</td>
                  <td className="px-3 py-2">
                    {t(i.kind === "credit_note" ? "creditNote" : `status.${i.status}`)}
                  </td>
                  <td className="px-3 py-2 text-right">{format.number(i.totalTtc)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
