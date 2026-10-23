import { getTranslations } from "next-intl/server";
import { requireMember } from "@/server/guards";

export default async function DashboardPage() {
  const member = await requireMember();
  const t = await getTranslations();
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold">{member.legalName}</h1>
      <p className="mt-2 text-stone-600">
        {t("dashboard.role", { role: t(`tenants.roles.${member.role}`) })}
      </p>
      <p className="mt-8 rounded-md border border-dashed border-stone-300 p-6 text-stone-500">
        {t("dashboard.comingSoon")}
      </p>
    </main>
  );
}
