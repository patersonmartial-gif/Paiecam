import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { getRequestContext } from "@/server/authz";
import { db } from "@/server/db";
import { makeGetPayslip } from "@/server/features/payroll";
import { requireMember } from "@/server/guards";

const getPayslip = makeGetPayslip(db);
const fcfa = (n: number) => n.toLocaleString("fr-FR");
const SECTIONS = [
  "earning",
  "allowance",
  "employee_contribution",
  "deduction",
  "employer_contribution",
] as const;

export default async function PayslipPage({
  params,
}: {
  params: Promise<{ periodId: string; payslipId: string }>;
}) {
  await requireMember();
  const t = await getTranslations("payroll");
  const format = await getFormatter();
  const { payslipId, periodId } = await params;
  const res = await getPayslip(await getRequestContext(), { payslipId });
  if (!res.ok || res.data.period.id !== periodId) notFound();
  const { slip, lines, period } = res.data;
  const e = slip.employeeSnapshot as {
    lastName: string;
    firstNames: string;
    matricule: string;
    jobTitle: string;
    category: string;
    echelon: string;
  };
  const rules = slip.rulesUsed as { code: string; validFrom: string; status: string }[];

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-10">
      <a href={`/paie/${periodId}`} className="text-sm text-stone-600 underline">
        ←{" "}
        {format.dateTime(new Date(Date.UTC(period.year, period.month - 1, 1)), {
          month: "long",
          year: "numeric",
        })}
      </a>
      {slip.status === "provisional" && (
        <p
          role="status"
          className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900"
        >
          {t("provisionalBanner")}
        </p>
      )}
      <header>
        <h1 className="text-2xl font-semibold">
          {t("payslip.title")} — {e.lastName} {e.firstNames}
        </h1>
        <p className="text-stone-600">
          {e.matricule} · {e.jobTitle} · cat. {e.category} / {e.echelon}
        </p>
      </header>
      {SECTIONS.map((section) => {
        const rows = lines.filter((l) => l.section === section);
        if (rows.length === 0) return null;
        return (
          <section key={section}>
            <h2 className="mb-2 font-semibold">{t(`payslip.section.${section}`)}</h2>
            <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-stone-50 text-left text-stone-600">
                  <tr>
                    <th className="px-3 py-2">{t("payslip.label")}</th>
                    <th className="px-3 py-2 text-right">{t("payslip.amount")}</th>
                    <th className="px-3 py-2">{t("payslip.detail")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {rows.map((l) => (
                    <tr key={l.id}>
                      <td className="px-3 py-2">{l.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fcfa(l.amount)}</td>
                      <td className="px-3 py-2 text-stone-600">{l.explanation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
      <dl className="grid max-w-md grid-cols-2 gap-y-1 rounded-lg border border-stone-200 bg-white p-4">
        <dt>{t("gross")}</dt>
        <dd className="text-right tabular-nums">{fcfa(slip.gross)}</dd>
        <dt className="font-semibold">{t("net")}</dt>
        <dd className="text-right text-lg font-semibold tabular-nums">{fcfa(slip.netPay)}</dd>
        <dt>{t("cost")}</dt>
        <dd className="text-right tabular-nums">{fcfa(slip.employerCost)}</dd>
      </dl>
      <section>
        <h2 className="mb-1 text-sm font-semibold">{t("payslip.rules")}</h2>
        <p className="text-xs text-stone-600">
          {rules
            .map(
              (r) =>
                `${r.code} (${r.validFrom}, ${r.status === "validated" ? t("payslip.validatedRule") : t("payslip.draft")})`,
            )
            .join(" · ")}
        </p>
      </section>
    </main>
  );
}
