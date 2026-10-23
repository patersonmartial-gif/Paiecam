import { isIP } from "node:net";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { schema, type Db } from "@paiecam/db";
import { log } from "../log";

/** Les champs ip sont de type inet : une valeur invalide est remplacée par null. */
export function safeIp(value: string | null | undefined): string | null {
  const ip = value?.split(",")[0]?.trim();
  return ip && isIP(ip) ? ip : null;
}

export async function auditAuthEvent(
  db: Db,
  event: {
    action: string;
    userId?: string | null;
    ip?: string | null;
    userAgent?: string | null;
    reason?: string;
  },
): Promise<void> {
  try {
    await db.insert(schema.auditLog).values({
      tenantId: null,
      actorUserId: event.userId ?? null,
      action: event.action,
      ip: safeIp(event.ip),
      userAgent: event.userAgent ?? null,
      after: event.reason ? { reason: event.reason } : null,
    });
  } catch (e) {
    // L'audit ne doit jamais bloquer une connexion ; l'échec est journalisé.
    log("error", "échec de l'audit d'authentification", { action: event.action, error: e });
  }
}

/** Échecs à tracer, par route Better Auth. Aucune adresse e-mail n'est stockée. */
const FAILURES: Record<string, string> = {
  "/sign-in/email": "auth.sign_in_failed",
  "/two-factor/verify-totp": "auth.two_factor_failed",
  "/two-factor/verify-backup-code": "auth.two_factor_failed",
  "/reset-password": "auth.password_reset_failed",
};

const SUCCESSES: Record<string, string> = {
  "/reset-password": "auth.password_reset",
  "/two-factor/enable": "auth.two_factor_setup_started",
  "/two-factor/disable": "auth.two_factor_disabled",
};

export function authAuditHook(db: Db) {
  return createAuthMiddleware(async (ctx) => {
    const returned = ctx.context.returned;
    const ip = ctx.headers?.get("x-forwarded-for") ?? null;
    const userAgent = ctx.headers?.get("user-agent") ?? null;
    if (returned instanceof APIError) {
      const action = FAILURES[ctx.path];
      if (action)
        await auditAuthEvent(db, { action, ip, userAgent, reason: String(returned.status) });
      return;
    }
    const action = SUCCESSES[ctx.path];
    if (action) {
      await auditAuthEvent(db, {
        action,
        userId: ctx.context.session?.user.id ?? null,
        ip,
        userAgent,
      });
    }
  });
}
