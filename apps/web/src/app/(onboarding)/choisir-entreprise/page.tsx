import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { eq, schema, withTenant, withUser } from "@paiecam/db";
import { Card } from "@/components/ui";
import { selectTenantAction } from "@/server/actions/company";
import { db } from "@/server/db";
import { requireUser } from "@/server/guards";

export default async function ChooseTenantPage() {
  const { user } = await requireUser();
  const t = await getTranslations("tenants");
  const memberships = await withUser(db, user.id, (tx) =>
    tx
      .select({ tenantId: schema.memberships.tenantId, role: schema.memberships.role })
      .from(schema.memberships)
      .where(eq(schema.memberships.userId, user.id)),
  );
  if (memberships.length === 0) redirect("/entreprise/nouvelle");

  // Les raisons sociales sont lues entreprise par entreprise, sous RLS.
  const items = await Promise.all(
    memberships.map(async (m) => ({
      ...m,
      legalName: await withTenant(
        db,
        { tenantId: m.tenantId, userId: user.id },
        async (tx) =>
          (await tx.select({ n: schema.tenants.legalName }).from(schema.tenants))[0]?.n ?? "",
      ),
    })),
  );

  return (
    <Card title={t("chooseTitle")}>
      <ul className="space-y-2">
        {items.map((m) => (
          <li key={m.tenantId}>
            <form action={selectTenantAction}>
              <input type="hidden" name="tenantId" value={m.tenantId} />
              <button className="w-full rounded-md border border-stone-300 px-4 py-3 text-left hover:border-brand">
                <span className="block font-medium">{m.legalName}</span>
                <span className="text-sm text-stone-600">{t(`roles.${m.role}`)}</span>
              </button>
            </form>
          </li>
        ))}
      </ul>
      <a
        href="/entreprise/nouvelle"
        className="mt-4 block text-center text-sm text-brand underline"
      >
        {t("addCompany")}
      </a>
    </Card>
  );
}
