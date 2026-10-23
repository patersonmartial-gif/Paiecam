import "server-only";
import { redirect } from "next/navigation";
import { and, eq, schema, withTenant } from "@paiecam/db";
import { getRequestContext } from "./authz";
import { ROLES_REQUIRING_2FA, type Role } from "./authz/permissions";
import { db } from "./db";

/**
 * Gardes de navigation pour les pages. Elles orientent l'utilisateur ; la sécurité réelle
 * reste dans defineAction et le RLS, qui revérifient tout à chaque appel.
 */
export async function requireUser() {
  const ctx = await getRequestContext();
  if (!ctx.user) redirect("/connexion");
  return { ...ctx, user: ctx.user };
}

export async function requireMember(): Promise<{
  userId: string;
  tenantId: string;
  role: Role;
  legalName: string;
}> {
  const ctx = await requireUser();
  const tenantId = ctx.tenantId;
  if (!tenantId || !/^[0-9a-f-]{36}$/i.test(tenantId)) redirect("/choisir-entreprise");
  const row = await withTenant(db, { tenantId, userId: ctx.user.id }, async (tx) => {
    const [m] = await tx
      .select({ role: schema.memberships.role, legalName: schema.tenants.legalName })
      .from(schema.memberships)
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.memberships.tenantId))
      .where(
        and(eq(schema.memberships.tenantId, tenantId), eq(schema.memberships.userId, ctx.user.id)),
      );
    return m;
  });
  if (!row) redirect("/choisir-entreprise");
  if (ROLES_REQUIRING_2FA.includes(row.role) && !ctx.user.twoFactorEnabled)
    redirect("/securite/2fa");
  return { userId: ctx.user.id, tenantId, role: row.role, legalName: row.legalName };
}
