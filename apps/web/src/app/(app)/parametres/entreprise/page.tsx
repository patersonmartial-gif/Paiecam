import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui";
import { getRequestContext } from "@/server/authz";
import { can } from "@/server/authz/permissions";
import { db } from "@/server/db";
import { makeGetCompany } from "@/server/features/company";
import { requireMember } from "@/server/guards";
import { CompanySettingsForm } from "./form";

const getCompany = makeGetCompany(db);

export default async function CompanySettingsPage() {
  const member = await requireMember();
  const t = await getTranslations("settings");
  const res = await getCompany(await getRequestContext(), {});
  if (!res.ok) throw new Error(res.error.code);
  const c = res.data;
  return (
    <Card title={t("companyTitle")}>
      <CompanySettingsForm
        canEdit={can(member.role, "tenant:update")}
        defaults={{
          legalName: c.legalName,
          niu: c.niu,
          cnpsEmployerNumber: c.cnpsEmployerNumber,
          regime: c.regime,
          workAccidentRate: c.workAccidentRate,
          commune: c.commune,
        }}
      />
    </Card>
  );
}
