import { getTranslations } from "next-intl/server";
import { getRequestContext } from "@/server/authz";
import { can } from "@/server/authz/permissions";
import { db } from "@/server/db";
import { makeListEmployees } from "@/server/features/employees";
import { requireMember } from "@/server/guards";

const list = makeListEmployees(db);

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; archives?: string }>;
}) {
  const member = await requireMember();
  const t = await getTranslations("employees");
  const { q, archives } = await searchParams;
  const res = await list(await getRequestContext(), {
    ...(q ? { q: q.slice(0, 100) } : {}),
    archived: archives === "1",
  });
  if (!res.ok) throw new Error(res.error.code);
  const canWrite = can(member.role, "employees:write");

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-2xl font-semibold">{t("title")}</h1>
        {canWrite && (
          <>
            <a
              href="/salaries/import"
              className="rounded-md border border-stone-300 px-4 py-2 text-sm font-medium"
            >
              {t("import")}
            </a>
            <a
              href="/salaries/nouveau"
              className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white"
            >
              {t("add")}
            </a>
          </>
        )}
      </div>
      <form className="mb-4 flex flex-wrap items-center gap-3">
        <input
          name="q"
          defaultValue={q}
          placeholder={t("search")}
          aria-label={t("search")}
          className="min-w-64 flex-1 rounded-md border border-stone-300 px-3 py-2"
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="archives" value="1" defaultChecked={archives === "1"} />
          {t("showArchived")}
        </label>
      </form>
      {res.data.length === 0 ? (
        <p className="rounded-md border border-dashed border-stone-300 p-6 text-stone-500">
          {t("empty")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-stone-50 text-stone-600">
              <tr>
                <th className="px-4 py-2">{t("fields.matricule")}</th>
                <th className="px-4 py-2">{t("fields.lastName")}</th>
                <th className="px-4 py-2">{t("fields.jobTitle")}</th>
                <th className="px-4 py-2">{t("fields.contractType")}</th>
                <th className="px-4 py-2 text-right">{t("fields.baseSalary")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {res.data.map((e) => (
                <tr key={e.id}>
                  <td className="px-4 py-2 font-mono">{e.matricule}</td>
                  <td className="px-4 py-2">
                    <a href={`/salaries/${e.id}`} className="text-brand underline">
                      {e.lastName} {e.firstNames}
                    </a>
                    {e.archivedAt && (
                      <span className="ml-2 rounded bg-stone-200 px-1.5 text-xs">
                        {t("archivedBadge")}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">{e.jobTitle}</td>
                  <td className="px-4 py-2">{t(`contractTypes.${e.contractType}`)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {e.baseSalary.toLocaleString("fr-FR")}
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
