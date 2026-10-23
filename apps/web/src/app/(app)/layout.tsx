import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { SignOutButton } from "@/components/sign-out-button";
import { can } from "@/server/authz/permissions";
import { requireMember } from "@/server/guards";

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
    { href: "/parametres/entreprise", label: t("company"), show: can(member.role, "tenant:read") },
    { href: "/parametres/equipe", label: t("team"), show: can(member.role, "members:read") },
  ];
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
      {children}
    </div>
  );
}
