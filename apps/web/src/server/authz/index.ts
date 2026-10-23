import "server-only";
import { cookies, headers } from "next/headers";
import type { z } from "zod";
import { CLIENT_IP_HEADER } from "@/lib/client-ip";
import { auth } from "../auth";
import { db } from "../db";
import {
  createTenantAction,
  createUserAction,
  type RequestContext,
  type TenantActionContext,
  type UserActionContext,
} from "./action";
import type { Permission } from "./permissions";

export const TENANT_COOKIE = "paiecam_tenant";

/** Contexte de la requête courante. L'entreprise du cookie sera vérifiée contre memberships. */
export async function getRequestContext(): Promise<RequestContext> {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });
  const jar = await cookies();
  return {
    user: session
      ? { id: session.user.id, twoFactorEnabled: session.user.twoFactorEnabled === true }
      : null,
    tenantId: jar.get(TENANT_COOKIE)?.value ?? null,
    // IP calculée par proxy.ts selon les proxys de confiance ; « 0.0.0.0 » = inconnue.
    ip: ((ip) => (ip && ip !== "0.0.0.0" ? ip : null))(h.get(CLIENT_IP_HEADER)),
    userAgent: h.get("user-agent"),
  };
}

export async function setActiveTenant(tenantId: string): Promise<void> {
  (await cookies()).set(TENANT_COOKIE, tenantId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 8 * 60 * 60,
  });
}

/** Server Action métier : auth → rôle → Zod → RLS → audit. Voir action.ts. */
export function defineAction<S extends z.ZodType, T>(
  options: { permission: Permission; input: S; audit: string },
  handler: (ctx: TenantActionContext, input: z.infer<S>) => Promise<T>,
) {
  const run = createTenantAction(db, options, handler);
  return async (input: z.input<S>) => run(await getRequestContext(), input);
}

/** Server Action d'un utilisateur connecté, hors entreprise. */
export function defineUserAction<S extends z.ZodType, T>(
  options: { input: S; audit: string },
  handler: (
    ctx: UserActionContext,
    input: z.infer<S>,
  ) => Promise<{ data: T; tenantId?: string; entityId?: string }>,
) {
  const run = createUserAction(db, options, handler);
  return async (input: z.input<S>) => run(await getRequestContext(), input);
}
