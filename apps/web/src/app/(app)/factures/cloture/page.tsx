import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { getRequestContext } from "@/server/authz";
import { can } from "@/server/authz/permissions";
import { db } from "@/server/db";
import { makeListInvoices } from "@/server/features/billing";
import { makeListClosings } from "@/server/features/reports";
import { requireMember } from "@/server/guards";
import { CloseForm } from "./close-form";

const listInvoices = makeListInvoices(db);
const listClosings = makeListClosings(db);

export default async function ClosingPage() {
  const member = await requireMember();
  const ctx = await getRequestContext();
  const [today, closings] = await Promise.all([listInvoices(ctx, {}), listClosings(ctx, {})]);
  if (!today.ok || !closings.ok) notFound();
  const t = await getTranslations("closing");
  const format = await getFormatter();
  const closedToday = closings.data.some((c) => c.day === today.data.day);
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-10">
      <a href="/factures" className="text-sm text-stone-600 underline">
        ← {t("back")}
      </a>
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="text-sm text-stone-600">{t("help")}</p>
      {can(member.role, "billing:issue") &&
        (closedToday ? (
          <p className="rounded-md bg-stone-100 px-3 py-2 text-sm">{t("alreadyClosed")}</p>
        ) : (
          <CloseForm expectedCash={today.data.byMean.cash ?? 0} />
        ))}
      <section>
        <h2 className="mb-2 font-semibold">{t("history")}</h2>
        {closings.data.length === 0 ? (
          <p className="text-sm text-stone-500">{t("none")}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-left text-stone-600">
                <tr>
                  <th className="px-3 py-2">{t("day")}</th>
                  <th className="px-3 py-2 text-right">{t("expected")}</th>
                  <th className="px-3 py-2 text-right">{t("counted")}</th>
                  <th className="px-3 py-2 text-right">{t("difference")}</th>
                  <th className="px-3 py-2">{t("note")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {closings.data.map((c) => {
                  const expected = c.expected as Record<string, number>;
                  return (
                    <tr key={c.id}>
                      <td className="px-3 py-2">
                        {format.dateTime(new Date(`${c.day}T12:00:00Z`), { dateStyle: "medium" })}
                      </td>
                      <td className="px-3 py-2 text-right">{format.number(expected.cash ?? 0)}</td>
                      <td className="px-3 py-2 text-right">{format.number(c.countedCash)}</td>
                      <td
                        className={`px-3 py-2 text-right ${c.difference === 0 ? "" : "font-semibold text-amber-800"}`}
                      >
                        {c.difference > 0 ? "+" : ""}
                        {format.number(c.difference)}
                      </td>
                      <td className="px-3 py-2">{c.note ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
