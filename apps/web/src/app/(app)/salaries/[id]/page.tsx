import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArchiveForm } from "@/components/employees/archive-form";
import { BankSection } from "@/components/employees/bank-section";
import { EmployeeForm } from "@/components/employees/employee-form";
import { LoansSection } from "@/components/employees/loans-section";
import { updateEmployeeAction } from "@/server/actions/employees";
import { getRequestContext } from "@/server/authz";
import { can } from "@/server/authz/permissions";
import { db } from "@/server/db";
import { makeGetEmployee } from "@/server/features/employees";
import { makeListLoans } from "@/server/features/loans";
import { makeListPeriods } from "@/server/features/payroll";
import { requireMember } from "@/server/guards";

const get = makeGetEmployee(db);
const listLoans = makeListLoans(db);
const listPeriods = makeListPeriods(db);

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const member = await requireMember();
  const t = await getTranslations("employees");
  const { id } = await params;
  const ctx = await getRequestContext();
  const res = await get(ctx, { id });
  if (!res.ok) notFound();
  const { employee, bank } = res.data;
  const canWrite = can(member.role, "employees:write") && !employee.archivedAt;
  const canReadPayroll = can(member.role, "payroll:read");
  // Mois ouvert le plus récent : c'est sur lui qu'une échéance peut être suspendue.
  const periods = canReadPayroll ? await listPeriods(ctx, {}) : null;
  const open = periods?.ok ? (periods.data.find((p) => p.status === "open") ?? null) : null;
  const loans = canReadPayroll
    ? await listLoans(ctx, { employeeId: employee.id, ...(open ? { periodId: open.id } : {}) })
    : null;

  return (
    <main className="mx-auto max-w-3xl space-y-10 px-4 py-10">
      <div>
        <a href="/salaries" className="text-sm text-stone-600 underline">
          ← {t("title")}
        </a>
        <h1 className="mt-2 text-2xl font-semibold">
          {employee.lastName} {employee.firstNames}
          {employee.archivedAt && (
            <span className="ml-2 rounded bg-stone-200 px-2 text-sm">{t("archivedBadge")}</span>
          )}
        </h1>
      </div>
      <EmployeeForm action={updateEmployeeAction} employee={employee} disabled={!canWrite} />
      <BankSection
        employeeId={employee.id}
        bank={bank}
        cnpsMasked={employee.cnpsNumberMasked}
        canWrite={canWrite}
        canReveal={can(member.role, "employees:sensitive")}
      />
      {loans?.ok && (
        <LoansSection
          employeeId={employee.id}
          loans={loans.data}
          openPeriod={open ? { id: open.id, year: open.year, month: open.month } : null}
          canWrite={can(member.role, "payroll:run") && !employee.archivedAt}
        />
      )}
      {can(member.role, "employees:sensitive") && (
        <section className="max-w-md rounded-lg border border-stone-200 bg-white p-4">
          <h2 className="mb-1 font-semibold">{t("dataRights.title")}</h2>
          <p className="mb-3 text-sm text-stone-600">{t("dataRights.help")}</p>
          <div className="flex gap-3 text-sm">
            <a
              href={`/salaries/${employee.id}/export?format=pdf`}
              className="rounded-md border border-stone-300 px-3 py-1.5 font-medium"
            >
              {t("dataRights.pdf")}
            </a>
            <a
              href={`/salaries/${employee.id}/export?format=json`}
              className="rounded-md border border-stone-300 px-3 py-1.5 font-medium"
            >
              {t("dataRights.json")}
            </a>
          </div>
        </section>
      )}
      {canWrite && <ArchiveForm employeeId={employee.id} />}
    </main>
  );
}
