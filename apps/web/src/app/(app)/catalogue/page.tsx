import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { getRequestContext } from "@/server/authz";
import { toggleCatalogItemAction } from "@/server/actions/catalog";
import { can } from "@/server/authz/permissions";
import { db } from "@/server/db";
import { makeListCatalog } from "@/server/features/catalog";
import { requireMember } from "@/server/guards";
import { NewItemForm, PriceForm } from "./forms";

const list = makeListCatalog(db);

export default async function CataloguePage() {
  const member = await requireMember();
  const res = await list(await getRequestContext(), {});
  if (!res.ok) notFound();
  const t = await getTranslations("catalog");
  const format = await getFormatter();
  const manage = can(member.role, "catalog:manage");
  return (
    <main className="mx-auto max-w-5xl space-y-8 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-stone-600">{t(manage ? "helpOwner" : "helpReadOnly")}</p>
      </div>
      {res.data.length === 0 ? (
        <p className="text-sm text-stone-500">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-stone-600">
              <tr>
                <th className="px-3 py-2">{t("code")}</th>
                <th className="px-3 py-2">{t("name")}</th>
                <th className="px-3 py-2">{t("kind")}</th>
                <th className="px-3 py-2">{t("taxCategory")}</th>
                <th className="px-3 py-2 text-right">{t("priceTtc")}</th>
                {manage && <th className="px-3 py-2">{t("status")}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {res.data.map((i) => (
                <tr key={i.id} className={i.active ? "" : "text-stone-400"}>
                  <td className="px-3 py-2 font-mono text-xs">{i.code}</td>
                  <td className="px-3 py-2">
                    {i.name}
                    {(i.form || i.unit) && (
                      <span className="block text-xs text-stone-500">
                        {[i.form, i.dosage, i.unit].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">{t(`kinds.${i.kind}`)}</td>
                  <td className="px-3 py-2">{t(`tax.${i.taxCategory}`)}</td>
                  <td className="px-3 py-2 text-right">
                    {manage ? (
                      <PriceForm id={i.id} name={i.name} priceTtc={i.priceTtc} />
                    ) : i.priceTtc === null ? (
                      "—"
                    ) : (
                      `${format.number(i.priceTtc)} FCFA`
                    )}
                  </td>
                  {manage && (
                    <td className="px-3 py-2">
                      <form action={toggleCatalogItemAction}>
                        {Object.entries({
                          id: i.id,
                          name: i.name,
                          form: i.form ?? "",
                          dosage: i.dosage ?? "",
                          unit: i.unit ?? "",
                          taxCategory: i.taxCategory,
                          alertThreshold: String(i.alertThreshold),
                          active: i.active ? "0" : "1",
                        }).map(([k, v]) => (
                          <input key={k} type="hidden" name={k} value={v} />
                        ))}
                        <button className="text-xs underline">
                          {t(i.active ? "deactivate" : "activate")}
                        </button>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {manage && <NewItemForm />}
    </main>
  );
}
