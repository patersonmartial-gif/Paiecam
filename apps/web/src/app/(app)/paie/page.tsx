import { getTranslations } from "next-intl/server";
import { PayrollForm } from "@/components/payroll/forms";
import { Select } from "@/components/ui";
import { openPeriodAction } from "@/server/actions/payroll";
import { getRequestContext } from "@/server/authz";
import { can } from "@/server/authz/permissions";
import { db } from "@/server/db";
import { makeListPeriods } from "@/server/features/payroll";
import { requireMember } from "@/server/guards";

const listPeriods = makeListPeriods(db);

export default async function PayrollPage() {
  const member = await requireMember();
  const t = await getTranslations("payroll");
  const res = await listPeriods(await getRequestContext(), {});
  if (!res.ok) throw new Error(res.error.code);
  const now = new Date();
  const monthName = (m: number) =>
    new Intl.DateTimeFormat("fr-FR", { month: "long" }).format(new Date(Date.UTC(2026, m - 1, 1)));

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-semibold">{t("title")}</h1>
      {res.data.length === 0 ? (
        <p className="mb-6 rounded-md border border-dashed border-stone-300 p-6 text-stone-500">
          {t("empty")}
        </p>
      ) : (
        <ul className="mb-8 divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
          {res.data.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-3">
              <a
                href={`/paie/${p.id}`}
                className="flex-1 font-medium capitalize text-brand underline"
              >
                {monthName(p.month)} {p.year}
              </a>
              <span className="rounded bg-stone-100 px-2 py-0.5 text-sm">
                {t(`status.${p.status}`)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {can(member.role, "payroll:run") && (
        <section className="max-w-md rounded-lg border border-stone-200 bg-white p-4">
          <PayrollForm action={openPeriodAction} submit={t("open")}>
            <div className="grid grid-cols-2 gap-3">
              <Select label={t("month")} name="month" defaultValue={String(now.getUTCMonth() + 1)}>
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {monthName(i + 1)}
                  </option>
                ))}
              </Select>
              <Select label={t("year")} name="year" defaultValue={String(now.getUTCFullYear())}>
                {[now.getUTCFullYear() - 1, now.getUTCFullYear(), now.getUTCFullYear() + 1].map(
                  (y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ),
                )}
              </Select>
            </div>
          </PayrollForm>
        </section>
      )}
    </main>
  );
}
