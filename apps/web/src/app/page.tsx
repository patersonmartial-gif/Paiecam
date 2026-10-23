import { getTranslations } from "next-intl/server";

export default async function Home() {
  const t = await getTranslations();
  return (
    <main className="mx-auto max-w-2xl px-4 py-16 text-center">
      <h1 className="text-3xl font-semibold">{t("common.appName")}</h1>
      <p className="mt-3 text-stone-600">{t("common.tagline")}</p>
      <div className="mt-8 flex justify-center gap-3">
        <a href="/inscription" className="rounded-md bg-brand px-4 py-2 font-medium text-white">
          {t("home.signUp")}
        </a>
        <a href="/connexion" className="rounded-md border border-stone-300 px-4 py-2 font-medium">
          {t("home.signIn")}
        </a>
      </div>
    </main>
  );
}
