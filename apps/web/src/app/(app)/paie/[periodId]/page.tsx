import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { DeclarationsSection } from "@/components/declarations/section";
import { PayrollForm } from "@/components/payroll/forms";
import { Field } from "@/components/ui";
import {
  calculatePeriodAction,
  reopenPeriodAction,
  saveVariablesAction,
  validatePeriodAction,
} from "@/server/actions/payroll";
import { getRequestContext } from "@/server/authz";
import { can } from "@/server/authz/permissions";
import { db } from "@/server/db";
import { makeListDeclarations } from "@/server/features/declarations";
import { makeGetPeriod } from "@/server/features/payroll";
import { requireMember } from "@/server/guards";

const getPeriod = makeGetPeriod(db);
const listDeclarations = makeListDeclarations(db);
const fcfa = (n: number) => n.toLocaleString("fr-FR");

export default async function PeriodPage({ params }: { params: Promise<{ periodId: string }> }) {
  const member = await requireMember();
  const t = await getTranslations("payroll");
  const locale = await getLocale();
  const format = await getFormatter();
  const { periodId } = await params;
  const res = await getPeriod(await getRequestContext(), { periodId });
  if (!res.ok) notFound();
  const { period, employees, items, overtimeCategories, variables, payslips } = res.data;
  const canRun = can(member.role, "payroll:run");
  const editable = canRun && period.status === "open";
  const value = (employeeId: string, key: string) => {
    const v = variables.find((x) => x.employeeId === employeeId && x.key === key)?.value;
    if (v === undefined) return "";
    return key.startsWith("hs:") ? String(v / 100) : String(v);
  };
  const columns = [
    ...items.map((i) => ({
      key: `item:${i.code}`,
      label: locale === "en" ? i.labelEn : i.labelFr,
    })),
    ...overtimeCategories.map((c) => ({ key: `hs:${c}`, label: t(`overtime.${c}`) })),
    { key: "absence", label: t("absence") },
  ];
  const provisional = payslips.some((p) => p.status === "provisional");
  const title = `${format.dateTime(new Date(Date.UTC(period.year, period.month - 1, 1)), { month: "long", year: "numeric" })}`;
  const sum = (k: "gross" | "netPay" | "employerCost") => payslips.reduce((s, p) => s + p[k], 0);

  return (
    <main className="mx-auto max-w-7xl space-y-8 px-4 py-10">
      <div>
        <a href="/paie" className="text-sm text-stone-600 underline">
          ← {t("back")}
        </a>
        <h1 className="mt-2 flex items-center gap-3 text-2xl font-semibold capitalize">
          {title}
          <span className="rounded bg-stone-100 px-2 py-0.5 text-sm normal-case">
            {t(`status.${period.status}`)}
          </span>
        </h1>
        {period.validatedAt && (
          <p className="mt-2 text-sm text-stone-600">
            {t("frozen", { date: format.dateTime(period.validatedAt, { dateStyle: "long" }) })}
          </p>
        )}
      </div>

      {provisional && (
        <p
          role="status"
          className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900"
        >
          {t("provisionalBanner")}
        </p>
      )}

      <section>
        <h2 className="mb-1 font-semibold">{t("variablesTitle")}</h2>
        <p className="mb-3 text-sm text-stone-600">{t("variablesHelp")}</p>
        <PayrollForm
          action={saveVariablesAction}
          periodId={period.id}
          submit={t("save")}
          className={editable ? "" : "hidden"}
        >
          <div className="mb-3 overflow-x-auto rounded-lg border border-stone-200 bg-white">
            <table className="text-sm">
              <thead className="bg-stone-50 text-left text-stone-600">
                <tr>
                  <th className="sticky left-0 bg-stone-50 px-3 py-2">{t("employee")}</th>
                  {columns.map((c) => (
                    <th key={c.key} className="min-w-28 px-2 py-2 font-medium">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {employees.map((e) => (
                  <tr key={e.id}>
                    <th
                      scope="row"
                      className="sticky left-0 whitespace-nowrap bg-white px-3 py-1 text-left font-medium"
                    >
                      {e.name}
                    </th>
                    {columns.map((c) => (
                      <td key={c.key} className="px-1 py-1">
                        <input
                          name={`v|${e.id}|${c.key}`}
                          defaultValue={value(e.id, c.key)}
                          inputMode="decimal"
                          disabled={!editable}
                          aria-label={`${e.name} — ${c.label}`}
                          className="w-24 rounded border border-stone-300 px-2 py-1 text-right tabular-nums disabled:bg-stone-50"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </PayrollForm>
      </section>

      {canRun && (period.status === "open" || period.status === "calculated") && (
        <div className="flex flex-wrap gap-3">
          <PayrollForm
            action={calculatePeriodAction}
            periodId={period.id}
            submit={period.status === "open" ? t("calculate") : t("recalculate")}
          />
          {period.status === "calculated" && (
            <PayrollForm
              action={reopenPeriodAction}
              periodId={period.id}
              submit={t("reopen")}
              variant="secondary"
            />
          )}
        </div>
      )}

      {payslips.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">{t("resultsTitle")}</h2>
          <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-left text-stone-600">
                <tr>
                  <th className="px-3 py-2">{t("employee")}</th>
                  <th className="px-3 py-2 text-right">{t("gross")}</th>
                  <th className="px-3 py-2 text-right">{t("net")}</th>
                  <th className="px-3 py-2 text-right">{t("cost")}</th>
                  <th className="px-3 py-2">{t("alerts")}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {payslips.map((p) => {
                  const e = employees.find((x) => x.id === p.employeeId);
                  return (
                    <tr key={p.id}>
                      <td className="px-3 py-2">{e?.name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fcfa(p.gross)}</td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">
                        {fcfa(p.netPay)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{fcfa(p.employerCost)}</td>
                      <td className="px-3 py-2">
                        {p.warnings.map((w) => (
                          <span
                            key={w}
                            className="mr-1 inline-block rounded bg-amber-100 px-1.5 text-xs text-amber-900"
                          >
                            {t(`warnings.${w}`)}
                          </span>
                        ))}
                      </td>
                      <td className="px-3 py-2">
                        <a
                          href={`/paie/${period.id}/bulletins/${p.id}`}
                          className="text-brand underline"
                        >
                          {t("view")}
                        </a>
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-stone-50 font-semibold">
                  <td className="px-3 py-2">{t("total")}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fcfa(sum("gross"))}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fcfa(sum("netPay"))}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fcfa(sum("employerCost"))}</td>
                  <td colSpan={2} />
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      {(period.status === "validated" || period.status === "locked") &&
        can(member.role, "declarations:read") && (
          <DeclarationsSection
            periodId={period.id}
            periodStatus={period.status}
            rows={await listDeclarations(await getRequestContext(), { periodId: period.id }).then(
              (r) => (r.ok ? r.data : []),
            )}
            canDeclare={can(member.role, "declarations:generate")}
            canLock={can(member.role, "payroll:validate")}
          />
        )}

      {period.status === "calculated" && can(member.role, "payroll:validate") && (
        <section className="max-w-md rounded-lg border border-stone-200 bg-white p-4">
          <h2 className="mb-1 font-semibold">{t("validateTitle")}</h2>
          <p className="mb-3 text-sm text-stone-600">{t("validateHelp")}</p>
          <PayrollForm action={validatePeriodAction} periodId={period.id} submit={t("validate")}>
            <Field
              label={t("password")}
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </PayrollForm>
        </section>
      )}
    </main>
  );
}
