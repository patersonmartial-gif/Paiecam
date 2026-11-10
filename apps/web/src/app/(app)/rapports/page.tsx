import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { getRequestContext } from "@/server/authz";
import { db } from "@/server/db";
import { makeSalesReport } from "@/server/features/reports";
import { todayInDouala } from "@/server/features/reminders";
import { makeStockOverview } from "@/server/features/stock";
import { can } from "@/server/authz/permissions";
import { requireMember } from "@/server/guards";

const report = makeSalesReport(db);
const stock = makeStockOverview(db);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ du?: string; au?: string }>;
}) {
  const member = await requireMember();
  const sp = await searchParams;
  const today = todayInDouala();
  const from = sp.du && ISO.test(sp.du) ? sp.du : `${today.slice(0, 7)}-01`;
  const to = sp.au && ISO.test(sp.au) ? sp.au : today;
  const ctx = await getRequestContext();
  const res = await report(ctx, { from, to });
  if (!res.ok) notFound();
  const st = can(member.role, "stock:read") ? await stock(ctx, {}) : null;
  const t = await getTranslations("reports");
  const tb = await getTranslations("billing");
  const format = await getFormatter();
  const r = res.data;
  const money = (n: number) => `${format.number(n)} FCFA`;
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <form className="flex flex-wrap items-end gap-2 text-sm">
          <label>
            <span className="mb-1 block">{t("from")}</span>
            <input
              type="date"
              name="du"
              defaultValue={from}
              className="rounded-md border border-stone-300 px-2 py-1"
            />
          </label>
          <label>
            <span className="mb-1 block">{t("to")}</span>
            <input
              type="date"
              name="au"
              defaultValue={to}
              className="rounded-md border border-stone-300 px-2 py-1"
            />
          </label>
          <button className="rounded-md border border-stone-300 px-3 py-1">{t("show")}</button>
          <a
            href={`/rapports/export?du=${from}&au=${to}`}
            className="rounded-md border border-stone-300 px-3 py-1"
          >
            {t("export")}
          </a>
        </form>
      </div>
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          [t("totalTtc"), money(r.totalTtc)],
          [t("totalHt"), money(r.totalHt)],
          [t("vat"), money(r.totalTax)],
          [t("margin"), money(r.medicineMargin)],
          [t("invoices"), String(r.invoiceCount)],
          [t("creditNotes"), String(r.creditNoteCount)],
          ...(["cash", "orange_money", "mtn_momo"] as const).map((m) => [
            tb(`means.${m}`),
            money(r.byMean[m] ?? 0),
          ]),
          ...(st?.ok ? [[t("stockValue"), money(st.data.totalValue)]] : []),
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-stone-200 bg-white p-3">
            <dt className="text-xs text-stone-500">{k}</dt>
            <dd className="text-lg font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      {r.items.length === 0 ? (
        <p className="text-sm text-stone-500">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-stone-600">
              <tr>
                <th className="px-3 py-2">{t("item")}</th>
                <th className="px-3 py-2 text-right">{t("quantity")}</th>
                <th className="px-3 py-2 text-right">{t("salesTtc")}</th>
                <th className="px-3 py-2 text-right">{t("salesHt")}</th>
                <th className="px-3 py-2 text-right">{t("cost")}</th>
                <th className="px-3 py-2 text-right">{t("itemMargin")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {r.items.map((i) => (
                <tr key={i.code}>
                  <td className="px-3 py-2">
                    {i.label} <span className="font-mono text-xs text-stone-500">{i.code}</span>
                  </td>
                  <td className="px-3 py-2 text-right">{format.number(i.quantity)}</td>
                  <td className="px-3 py-2 text-right">{format.number(i.ttc)}</td>
                  <td className="px-3 py-2 text-right">{format.number(i.ht)}</td>
                  <td className="px-3 py-2 text-right">
                    {i.kind === "medicine" ? format.number(i.cost) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {i.margin === null ? "—" : format.number(i.margin)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-stone-500">{t("note")}</p>
    </main>
  );
}
