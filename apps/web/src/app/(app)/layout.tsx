import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { SignOutButton } from "@/components/sign-out-button";
import { env } from "@/env";
import { can } from "@/server/authz/permissions";
import { requireMember } from "@/server/guards";
import { lastBackupAge, localBackupConfigured } from "@/server/jobs/local-backup";

/** Au-delà, le propriétaire est averti à chaque page (installation locale). */
const BACKUP_WARNING_MS = 3 * 24 * 3600 * 1000;

export default async function AppLayout({ children }: { children: ReactNode }) {
  const member = await requireMember();
  const t = await getTranslations("nav");
  const local = env.DEPLOYMENT === "local" && localBackupConfigured(env);
  const isOwner = can(member.role, "tenant:update");
  // Menu regroupé par métier : chaque rôle ne voit que les groupes où il a au moins un accès.
  const groups = [
    {
      label: t("groupStaff"),
      links: [
        { href: "/salaries", label: t("employees"), show: can(member.role, "employees:read") },
        { href: "/paie", label: t("payroll"), show: can(member.role, "payroll:read") },
        {
          href: "/declarations",
          label: t("declarations"),
          show: can(member.role, "declarations:read"),
        },
      ],
    },
    {
      label: t("groupClinic"),
      links: [
        { href: "/caisse", label: t("cash"), show: can(member.role, "billing:issue") },
        { href: "/factures", label: t("invoices"), show: can(member.role, "billing:read") },
        { href: "/rapports", label: t("reports"), show: can(member.role, "billing:read") },
        { href: "/stock", label: t("stock"), show: can(member.role, "stock:read") },
        { href: "/catalogue", label: t("catalog"), show: can(member.role, "catalog:read") },
      ],
    },
    {
      label: t("groupSettings"),
      links: [
        {
          href: "/parametres/entreprise",
          label: t("company"),
          show: can(member.role, "tenant:read"),
        },
        { href: "/parametres/equipe", label: t("team"), show: can(member.role, "members:read") },
        { href: "/parametres/sauvegardes", label: t("backups"), show: local && isOwner },
      ],
    },
  ]
    .map((g) => ({ ...g, links: g.links.filter((l) => l.show) }))
    .filter((g) => g.links.length > 0);
  const age = local && isOwner ? await lastBackupAge(env) : null;
  const backupLate = local && isOwner && (age === null || age > BACKUP_WARNING_MS);
  return (
    <div>
      <header className="border-b border-stone-200 bg-white text-sm">
        <div className="flex flex-wrap items-center gap-4 px-4 pt-2">
          <a href="/tableau-de-bord" className="font-medium hover:text-brand">
            {member.legalName}
          </a>
          <a href="/tableau-de-bord" className="text-stone-700 hover:text-brand">
            {t("dashboard")}
          </a>
          <a href="/choisir-entreprise" className="ml-auto text-stone-500 hover:text-brand">
            {t("switchCompany")}
          </a>
          <SignOutButton />
        </div>
        <nav className="flex flex-wrap gap-x-8 gap-y-2 px-4 py-2">
          {groups.map((g) => (
            <div key={g.label} className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-semibold tracking-wide text-stone-400 uppercase">
                {g.label}
              </span>
              {g.links.map((l) => (
                <a key={l.href} href={l.href} className="text-stone-700 hover:text-brand">
                  {l.label}
                </a>
              ))}
            </div>
          ))}
        </nav>
      </header>
      {backupLate && (
        <p
          role="alert"
          className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900"
        >
          {t("backupLate")}{" "}
          <a href="/parametres/sauvegardes" className="underline">
            {t("backups")}
          </a>
        </p>
      )}
      {children}
    </div>
  );
}
