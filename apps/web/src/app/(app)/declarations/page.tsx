import { getTranslations } from "next-intl/server";
import { getRequestContext } from "@/server/authz";
import { db } from "@/server/db";
import { makeListDeclarations } from "@/server/features/declarations";
import { requireMember } from "@/server/guards";

const list = makeListDeclarations(db);
const fr = (iso: string) => iso.split("-").reverse().join("/");

/** Calendrier : toutes les déclarations, de la plus proche échéance à la plus lointaine. */
export default async function DeclarationsCalendarPage() {
  await requireMember();
  const t = await getTranslations("declarations");
  const res = await list(await getRequestContext(), {});
  if (!res.ok) throw new Error(res.error.code);
  const today = new Date().toISOString().slice(0, 10);
  const pending = res.data.filter((d) => d.status === "generated");
  const done = res.data.filter((d) => d.status !== "generated").reverse();
  const row = (d: (typeof res.data)[number]) => (
    <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
      <span className="w-28 font-medium tabular-nums">{fr(d.dueDate)}</span>
      <span className="flex-1">
        {t(`kinds.${d.kind}`)} — {String(d.month).padStart(2, "0")}/{d.year}
      </span>
      {d.status === "generated" && d.dueDate < today && (
        <span className="rounded bg-red-100 px-2 text-sm text-red-800">{t("late")}</span>
      )}
      <span className="rounded bg-stone-100 px-2 text-sm">{t(`status.${d.status}`)}</span>
      <a href={`/paie/${d.periodId}`} className="text-sm text-brand underline">
        {t("open")}
      </a>
    </li>
  );
  return (
    <main className="mx-auto max-w-4xl space-y-8 px-4 py-10">
      <h1 className="text-2xl font-semibold">{t("calendarTitle")}</h1>
      <section>
        <h2 className="mb-2 font-semibold">{t("upcoming")}</h2>
        {pending.length === 0 ? (
          <p className="text-stone-600">{t("nothingDue")}</p>
        ) : (
          <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
            {pending.map(row)}
          </ul>
        )}
      </section>
      {done.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">{t("history")}</h2>
          <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
            {done.map(row)}
          </ul>
        </section>
      )}
    </main>
  );
}
