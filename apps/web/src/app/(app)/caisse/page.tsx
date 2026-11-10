import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getRequestContext } from "@/server/authz";
import { can } from "@/server/authz/permissions";
import { db } from "@/server/db";
import { makeListCatalog } from "@/server/features/catalog";
import { makeStockOverview } from "@/server/features/stock";
import { requireMember } from "@/server/guards";
import { SaleForm } from "./sale-form";

const listCatalog = makeListCatalog(db);
const overview = makeStockOverview(db);

export default async function CashierPage() {
  const member = await requireMember();
  if (!can(member.role, "billing:issue")) notFound();
  const ctx = await getRequestContext();
  const [catalog, stock] = await Promise.all([listCatalog(ctx, {}), overview(ctx, {})]);
  if (!catalog.ok || !stock.ok) notFound();
  const available = new Map(stock.data.medicines.map((m) => [m.id, m.available]));
  const t = await getTranslations("billing");
  const items = catalog.data
    .filter((i) => i.active && i.priceTtc !== null)
    .map((i) => ({
      id: i.id,
      kind: i.kind,
      code: i.code,
      name: i.name,
      priceTtc: i.priceTtc ?? 0,
      available: i.kind === "medicine" ? (available.get(i.id) ?? 0) : null,
    }));
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold">{t("cashTitle")}</h1>
        <p className="mt-1 text-sm text-stone-600">{t("cashHelp")}</p>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-stone-500">{t("noItems")}</p>
      ) : (
        <SaleForm items={items} />
      )}
    </main>
  );
}
