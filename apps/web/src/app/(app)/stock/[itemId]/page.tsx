import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { getRequestContext } from "@/server/authz";
import { can } from "@/server/authz/permissions";
import { db } from "@/server/db";
import { makeItemStock } from "@/server/features/stock";
import { requireMember } from "@/server/guards";
import { AdjustForm, ReceiveForm } from "../forms";

const itemStock = makeItemStock(db);

export default async function StockItemPage({ params }: { params: Promise<{ itemId: string }> }) {
  const member = await requireMember();
  const { itemId } = await params;
  const res = await itemStock(await getRequestContext(), { itemId });
  if (!res.ok) notFound();
  const t = await getTranslations("stock");
  const format = await getFormatter();
  const fmtDate = (d: string) =>
    format.dateTime(new Date(`${d}T12:00:00Z`), { dateStyle: "medium" });
  const { item, lots, history } = res.data;
  const manage = can(member.role, "stock:manage");
  const withStock = lots.filter((l) => l.quantityOnHand > 0);
  return (
    <main className="mx-auto max-w-5xl space-y-8 px-4 py-10">
      <div>
        <a href="/stock" className="text-sm text-stone-600 underline">
          ← {t("title")}
        </a>
        <h1 className="mt-2 text-2xl font-semibold">{item.name}</h1>
        <p className="font-mono text-sm text-stone-500">{item.code}</p>
      </div>
      <section>
        <h2 className="mb-2 font-semibold">{t("lots")}</h2>
        {lots.length === 0 ? (
          <p className="text-sm text-stone-500">{t("noLots")}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-left text-stone-600">
                <tr>
                  <th className="px-3 py-2">{t("lotNumber")}</th>
                  <th className="px-3 py-2">{t("expiryDate")}</th>
                  <th className="px-3 py-2 text-right">{t("onHand")}</th>
                  <th className="px-3 py-2 text-right">{t("unitCost")}</th>
                  <th className="px-3 py-2">{t("supplier")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {lots.map((l) => (
                  <tr key={l.id}>
                    <td className="px-3 py-2 font-mono text-xs">{l.lotNumber}</td>
                    <td className="px-3 py-2">{fmtDate(l.expiryDate)}</td>
                    <td className="px-3 py-2 text-right">{format.number(l.quantityOnHand)}</td>
                    <td className="px-3 py-2 text-right">{format.number(l.unitCost)}</td>
                    <td className="px-3 py-2">{l.supplier ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {manage && (
        <div className="grid gap-6 lg:grid-cols-2">
          <ReceiveForm itemId={item.id} />
          {withStock.length > 0 && (
            <AdjustForm
              itemId={item.id}
              lots={withStock.map((l) => ({
                id: l.id,
                label: `${l.lotNumber} — ${fmtDate(l.expiryDate)} (${l.quantityOnHand})`,
              }))}
            />
          )}
        </div>
      )}
      <section>
        <h2 className="mb-2 font-semibold">{t("history")}</h2>
        {history.length === 0 ? (
          <p className="text-sm text-stone-500">{t("noHistory")}</p>
        ) : (
          <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                <span>
                  {format.dateTime(h.createdAt, { dateStyle: "short", timeStyle: "short" })} ·{" "}
                  {t(`kinds.${h.kind}`)} · {t("lot")} {h.lotNumber}
                  {h.reason ? ` · ${h.reason}` : ""}
                </span>
                <span className={h.quantity > 0 ? "text-green-700" : "text-red-700"}>
                  {h.quantity > 0 ? "+" : ""}
                  {format.number(h.quantity)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
