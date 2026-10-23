import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui";
import { requireUser } from "@/server/guards";
import { CompanyForm } from "./company-form";

export default async function NewCompanyPage() {
  await requireUser();
  const t = await getTranslations("company");
  return (
    <Card title={t("title")}>
      <p className="mb-4 text-sm text-stone-600">{t("help")}</p>
      <CompanyForm />
    </Card>
  );
}
