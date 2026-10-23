import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui";
import { requireUser } from "@/server/guards";
import { TwoFactorSetup } from "./setup";

export default async function TwoFactorSetupPage() {
  const { user } = await requireUser();
  const t = await getTranslations("twoFactor");
  return (
    <Card title={t("setupTitle")}>
      {user.twoFactorEnabled ? (
        <p>
          {t("enabled")}{" "}
          <a className="text-brand underline" href="/tableau-de-bord">
            →
          </a>
        </p>
      ) : (
        <>
          <p className="mb-4 text-sm text-stone-600">{t("setupWhy")}</p>
          <TwoFactorSetup />
        </>
      )}
    </Card>
  );
}
