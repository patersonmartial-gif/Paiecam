import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { getRequestContext } from "@/server/authz";
import { can } from "@/server/authz/permissions";
import { db } from "@/server/db";
import { makeStockOverview } from "@/server/features/stock";
import { requireMember } from "@/server/guards";
import { ExpiryAlertForm } from "./forms";

const overview = makeStockOverview(db);
const ALERT_STYLE: Record<string, string> = {
  out_of_stock: "bg-red-100 text-red-800",
  low_stock: "bg-amber-100 text-amber-900",
  expiring_soon: "bg-amber-100 text-amber-900",
  expired_on_hand: "bg-red-100 text-red-800",
};

export default async function StockPage() {
  const member = await requireMember();
  const res = await overview(await getRequestContext(), {});
  if (!res.ok) notFound();
  const t = await getTranslations("stock");
  const format = await getFormatter();
  const fmtDate = (d: string) =>
    format.dateTime(new Date(`${d}T12:00:00Z`), { dateStyle: "medium" });
  const { medicines, totalValue, alertDays } = res.data;
  const alerts = medicines.filter((m) => m.active && m.alerts.length > 0).length;
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="mt-1 text-sm text-stone-600">
            {t("summary", { value: format.number(totalValue), alerts, days: alertDays })}
          </p>
        </div>
        {can(member.role, "tenant:update") && <ExpiryAlertForm days={alertDays} />}
      </div>
      {medicines.length === 0 ? (
        <p className="text-sm text-stone-500">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-stone-600">
              <tr>
                <th className="px-3 py-2">{t("medicine")}</th>
                <th className="px-3 py-2 text-right">{t("available")}</th>
                <th className="px-3 py-2">{t("nextExpiry")}</th>
                <th className="px-3 py-2 text-right">{t("value")}</th>
                <th className="px-3 py-2">{t("alerts")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {medicines.map((m) => (
                <tr key={m.id} className={m.active ? "" : "text-stone-400"}>
                  <td className="px-3 py-2">
                    <a href={`/stock/${m.id}`} className="underline">
                      {m.name}
                    </a>
                    <span className="block font-mono text-xs text-stone-500">{m.code}</span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {format.number(m.available)}
                    {/* Unité saisie librement (« Boîte de 12 ») : affichée à part, sans accord. */}
                    {m.unit && <span className="block text-xs text-stone-500">{m.unit}</span>}
                  </td>
                  <td className="px-3 py-2">{m.nextExpiry ? fmtDate(m.nextExpiry) : "—"}</td>
                  <td className="px-3 py-2 text-right">{format.number(m.value)}</td>
                  <td className="px-3 py-2">
                    <span className="flex flex-wrap gap-1">
                      {m.alerts.map((a) => (
                        <span key={a} className={`rounded px-1.5 text-xs ${ALERT_STYLE[a] ?? ""}`}>
                          {t(`alert.${a}`, { expired: m.expired, soon: m.expiringSoon })}
                        </span>
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
