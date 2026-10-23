import { getLocale, getTranslations } from "next-intl/server";
import { setLocaleAction } from "@/server/actions/locale";

export async function LocaleSwitcher() {
  const locale = await getLocale();
  const t = await getTranslations("common");
  return (
    <form action={setLocaleAction}>
      <input type="hidden" name="locale" value={locale === "fr" ? "en" : "fr"} />
      <button className="text-sm text-stone-600 underline">{t("language")}</button>
    </form>
  );
}
