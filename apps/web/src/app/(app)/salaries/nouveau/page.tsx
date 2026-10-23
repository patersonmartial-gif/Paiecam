import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { EmployeeForm } from "@/components/employees/employee-form";
import { createEmployeeAction } from "@/server/actions/employees";
import { can } from "@/server/authz/permissions";
import { requireMember } from "@/server/guards";

export default async function NewEmployeePage() {
  const member = await requireMember();
  if (!can(member.role, "employees:write")) redirect("/salaries");
  const t = await getTranslations("employees");
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-semibold">{t("newTitle")}</h1>
      <EmployeeForm action={createEmployeeAction} />
    </main>
  );
}
