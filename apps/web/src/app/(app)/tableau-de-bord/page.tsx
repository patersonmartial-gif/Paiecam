import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { getRequestContext } from "@/server/authz";
import { can } from "@/server/authz/permissions";
import { db } from "@/server/db";
import { makeListInvoices } from "@/server/features/billing";
import { makeListDeclarations } from "@/server/features/declarations";
import { makeListEmployees } from "@/server/features/employees";
import { makeListPeriods } from "@/server/features/payroll";
import { makeStockOverview } from "@/server/features/stock";
import { requireMember } from "@/server/guards";

const invoices = makeListInvoices(db);
const stock = makeStockOverview(db);
const periods = makeListPeriods(db);
const declarations = makeListDeclarations(db);
const employees = makeListEmployees(db);

function Tile(props: {
  title: string;
  value: string;
  detail?: string;
  href: string;
  tone?: "warn";
}) {
  return (
    <a
      href={props.href}
      className={`block rounded-lg border bg-white p-4 hover:border-brand ${props.tone === "warn" ? "border-amber-300" : "border-stone-200"}`}
    >
      <p className="text-sm text-stone-600">{props.title}</p>
      <p className="mt-1 text-2xl font-semibold">{props.value}</p>
      {props.detail && <p className="mt-1 text-sm text-stone-500">{props.detail}</p>}
    </a>
  );
}

/** Tableau de bord : une tuile par domaine que le rôle peut consulter. */
export default async function DashboardPage() {
  const member = await requireMember();
  const t = await getTranslations("dashboard");
  const tr = await getTranslations();
  const format = await getFormatter();
  const ctx = await getRequestContext();
  const tiles: ReactNode[] = [];

  if (can(member.role, "billing:read")) {
    const r = await invoices(ctx, {});
    if (r.ok)
      tiles.push(
        <Tile
          key="sales"
          title={t("salesToday")}
          value={`${format.number(r.data.total)} FCFA`}
          detail={t("invoicesCount", {
            n: r.data.invoices.filter((i) => i.kind === "invoice").length,
          })}
          href="/factures"
        />,
      );
  }
  if (can(member.role, "stock:read")) {
    const r = await stock(ctx, {});
    if (r.ok) {
      const alerts = r.data.medicines.filter((m) => m.active && m.alerts.length > 0).length;
      tiles.push(
        <Tile
          key="stock"
          title={t("stockAlerts")}
          value={String(alerts)}
          detail={t("stockValue", { value: format.number(r.data.totalValue) })}
          href="/stock"
          {...(alerts > 0 ? { tone: "warn" as const } : {})}
        />,
      );
    }
  }
  if (can(member.role, "payroll:read")) {
    const r = await periods(ctx, {});
    const last = r.ok ? r.data[0] : undefined;
    tiles.push(
      <Tile
        key="payroll"
        title={t("payroll")}
        value={
          last
            ? format.dateTime(new Date(Date.UTC(last.year, last.month - 1, 15)), {
                month: "long",
                year: "numeric",
              })
            : "—"
        }
        detail={last ? tr(`payroll.status.${last.status}`) : t("noPeriod")}
        href={last ? `/paie/${last.id}` : "/paie"}
      />,
    );
  }
  if (can(member.role, "declarations:read")) {
    const r = await declarations(ctx, {});
    const next = r.ok ? r.data.find((d) => d.status === "generated") : undefined;
    tiles.push(
      <Tile
        key="declarations"
        title={t("nextDeclaration")}
        value={
          next
            ? format.dateTime(new Date(`${next.dueDate}T12:00:00Z`), { dateStyle: "medium" })
            : "—"
        }
        detail={next ? tr(`declarations.kinds.${next.kind}`) : t("noDeclaration")}
        href="/declarations"
        {...(next ? { tone: "warn" as const } : {})}
      />,
    );
  }
  if (can(member.role, "employees:read")) {
    const r = await employees(ctx, {});
    if (r.ok)
      tiles.push(
        <Tile
          key="employees"
          title={t("employees")}
          value={String(r.data.length)}
          href="/salaries"
        />,
      );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-2xl font-semibold">{member.legalName}</h1>
      <p className="mt-1 text-stone-600">
        {t("role", { role: tr(`tenants.roles.${member.role}`) })}
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{tiles}</div>
    </main>
  );
}
