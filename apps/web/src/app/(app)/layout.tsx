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
  const links = [
    { href: "/tableau-de-bord", label: t("dashboard"), show: true },
    { href: "/salaries", label: t("employees"), show: can(member.role, "employees:read") },
    { href: "/paie", label: t("payroll"), show: can(member.role, "payroll:read") },
    {
      href: "/declarations",
      label: t("declarations"),
      show: can(member.role, "declarations:read"),
    },
    { href: "/catalogue", label: t("catalog"), show: can(member.role, "catalog:read") },
    { href: "/parametres/entreprise", label: t("company"), show: can(member.role, "tenant:read") },
    { href: "/parametres/equipe", label: t("team"), show: can(member.role, "members:read") },
  ];
  const local = env.DEPLOYMENT === "local" && localBackupConfigured(env);
  const isOwner = can(member.role, "tenant:update");
  if (local && isOwner)
    links.push({ href: "/parametres/sauvegardes", label: t("backups"), show: true });
  const age = local && isOwner ? await lastBackupAge(env) : null;
  const backupLate = local && isOwner && (age === null || age > BACKUP_WARNING_MS);
  return (
    <div>
      <nav className="flex flex-wrap items-center gap-4 border-b border-stone-200 bg-white px-4 py-2 text-sm">
        <span className="font-medium">{member.legalName}</span>
        {links
          .filter((l) => l.show)
          .map((l) => (
            <a key={l.href} href={l.href} className="text-stone-700 hover:text-brand">
              {l.label}
            </a>
          ))}
        <a href="/choisir-entreprise" className="ml-auto text-stone-500 hover:text-brand">
          {t("switchCompany")}
        </a>
        <SignOutButton />
      </nav>
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
