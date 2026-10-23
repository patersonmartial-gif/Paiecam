import { getTranslations } from "next-intl/server";
import { legalDocument, type LegalDocument } from "@/content/legal";

export async function LegalPage({ slug }: { slug: LegalDocument["slug"] }) {
  const t = await getTranslations("legal");
  const doc = legalDocument(slug);
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <p
        role="note"
        className="mb-6 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
      >
        {t("draftNotice")}
      </p>
      <h1 className="text-2xl font-semibold">{doc.title}</h1>
      <p className="mt-1 text-sm text-stone-500">{t("version", { version: doc.version })}</p>
      {doc.sections.map((s) => (
        <section key={s.title} className="mt-8">
          <h2 className="text-lg font-semibold">{s.title}</h2>
          {s.paragraphs.map((p) => (
            <p key={p} className="mt-3 leading-relaxed text-stone-700">
              {p}
            </p>
          ))}
        </section>
      ))}
    </main>
  );
}
