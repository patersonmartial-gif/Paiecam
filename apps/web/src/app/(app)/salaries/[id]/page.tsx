import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArchiveForm } from "@/components/employees/archive-form";
import { BankSection } from "@/components/employees/bank-section";
import { EmployeeForm } from "@/components/employees/employee-form";
import { updateEmployeeAction } from "@/server/actions/employees";
import { getRequestContext } from "@/server/authz";
import { can } from "@/server/authz/permissions";
import { db } from "@/server/db";
import { makeGetEmployee } from "@/server/features/employees";
import { requireMember } from "@/server/guards";

const get = makeGetEmployee(db);

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const member = await requireMember();
  const t = await getTranslations("employees");
  const { id } = await params;
  const res = await get(await getRequestContext(), { id });
  if (!res.ok) notFound();
  const { employee, bank } = res.data;
  const canWrite = can(member.role, "employees:write") && !employee.archivedAt;

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
      {canWrite && <ArchiveForm employeeId={employee.id} />}
    </main>
  );
}
