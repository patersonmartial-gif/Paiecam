import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { can } from "@/server/authz/permissions";
import { requireMember } from "@/server/guards";
import { ImportForm } from "./import-form";

export default async function ImportEmployeesPage() {
  const member = await requireMember();
  if (!can(member.role, "employees:write")) redirect("/salaries");
  const t = await getTranslations("import");
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <a href="/salaries" className="text-sm text-stone-600 underline">
        ← {t("back")}
      </a>
      <h1 className="mb-2 mt-2 text-2xl font-semibold">{t("title")}</h1>
      <ol className="mb-6 list-decimal space-y-1 pl-5 text-sm text-stone-700">
        <li>
          <a href="/salaries/import/modele" className="text-brand underline">
            {t("step1")}
          </a>
        </li>
        <li>{t("step2")}</li>
        <li>{t("step3")}</li>
      </ol>
      <ImportForm />
    </main>
  );
}
