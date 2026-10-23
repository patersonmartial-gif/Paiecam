import { z } from "zod";
import { and, eq, schema, withTenant, withUser, type Db, type Tx } from "@paiecam/db";
import { log, maskPII } from "../log";
import { can, ROLES_REQUIRING_2FA, type Permission, type Role } from "./permissions";

export interface SessionUser {
  id: string;
  twoFactorEnabled: boolean;
}

/** Ce que l'environnement (Next.js, ou un test) fournit à chaque appel. */
export interface RequestContext {
  user: SessionUser | null;
  /** Entreprise choisie (cookie) : jamais crue sur parole, toujours vérifiée contre memberships. */
  tenantId: string | null;
  ip: string | null;
  userAgent: string | null;
}

export type ActionError =
  | { code: "UNAUTHENTICATED" }
  | { code: "NO_TENANT" }
  | { code: "FORBIDDEN" }
  | { code: "TWO_FACTOR_REQUIRED" }
  | { code: "INVALID_INPUT"; fields: Record<string, string[]> }
  /** Contrainte d'unicité violée ; `constraint` permet un message précis (ex. NIU déjà inscrit). */
  | { code: "CONFLICT"; constraint: string }
  | { code: "INTERNAL" };

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };

export interface AuditEntry {
  action: string;
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
}

export interface TenantActionContext {
  tx: Tx;
  userId: string;
  tenantId: string;
  role: Role;
  /** Ajoute des détails à la ligne d'audit de l'action (masqués automatiquement). */
  audit: (details: Omit<AuditEntry, "action">) => void;
}

const UUID = z.uuid();

class Denied extends Error {
  constructor(readonly error: ActionError) {
    super(error.code);
  }
}

function invalidInput(error: z.ZodError): ActionError {
  return {
    code: "INVALID_INPUT",
    fields: z.flattenError(error).fieldErrors as Record<string, string[]>,
  };
}

/** Violation d'unicité PostgreSQL (23505), éventuellement emballée par Drizzle. */
function uniqueViolation(e: unknown): ActionError | null {
  const pg =
    (e as { cause?: { code?: string; constraint_name?: string } }).cause ??
    (e as { code?: string; constraint_name?: string });
  return pg?.code === "23505" ? { code: "CONFLICT", constraint: pg.constraint_name ?? "" } : null;
}

/**
 * Trace un refus dans le journal de l'entreprise visée : elle voit les tentatives d'accès contre elle.
 * Si l'entreprise n'existe pas, la trace est écrite hors entreprise.
 */
async function auditDenied(db: Db, ctx: RequestContext, action: string, error: ActionError) {
  const row = {
    actorUserId: ctx.user?.id ?? null,
    action: `denied:${action}`,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    after: { reason: error.code },
  };
  try {
    if (ctx.tenantId && ctx.user) {
      const tenantId = ctx.tenantId;
      await withTenant(db, { tenantId, userId: ctx.user.id }, (tx) =>
        tx.insert(schema.auditLog).values({ ...row, tenantId }),
      );
      return;
    }
  } catch {
    // entreprise inexistante : trace hors entreprise ci-dessous
  }
  try {
    await db
      .insert(schema.auditLog)
      .values({ ...row, tenantId: null, entityType: "tenant", entityId: ctx.tenantId });
  } catch (e) {
    log("error", "échec de l'audit d'un refus", { action, error: e });
  }
}

/**
 * Action métier dans une entreprise. Ordre imposé (CLAUDE.md) :
 * 1) session, 2) appartenance + permission + 2FA, 3) validation Zod,
 * 4) exécution sous RLS, 5) audit dans la même transaction (tout ou rien).
 */
export function createTenantAction<S extends z.ZodType, T>(
  db: Db,
  options: { permission: Permission; input: S; audit: string },
  handler: (ctx: TenantActionContext, input: z.infer<S>) => Promise<T>,
) {
  return async (ctx: RequestContext, rawInput: unknown): Promise<ActionResult<T>> => {
    try {
      // 1) Authentification
      const user = ctx.user;
      if (!user) throw new Denied({ code: "UNAUTHENTICATED" });
      if (!ctx.tenantId || !UUID.safeParse(ctx.tenantId).success) {
        throw new Denied({ code: "NO_TENANT" });
      }
      const tenantId = ctx.tenantId;

      // 3) Validation (avant d'ouvrir la transaction ; l'ordre de refus reste auth → rôle → entrée)
      const parsed = options.input.safeParse(rawInput);

      const data = await withTenant(db, { tenantId, userId: user.id }, async (tx) => {
        // 2) Autorisation : l'appartenance est lue sous RLS, dans le tenant demandé.
        const [membership] = await tx
          .select({ role: schema.memberships.role })
          .from(schema.memberships)
          .where(
            and(eq(schema.memberships.tenantId, tenantId), eq(schema.memberships.userId, user.id)),
          );
        if (!membership) throw new Denied({ code: "FORBIDDEN" });
        if (!can(membership.role, options.permission)) throw new Denied({ code: "FORBIDDEN" });
        if (ROLES_REQUIRING_2FA.includes(membership.role) && !user.twoFactorEnabled) {
          throw new Denied({ code: "TWO_FACTOR_REQUIRED" });
        }
        if (!parsed.success) throw new Denied(invalidInput(parsed.error));

        // 4) Exécution
        let details: Omit<AuditEntry, "action"> = {};
        const result = await handler(
          {
            tx,
            userId: user.id,
            tenantId,
            role: membership.role,
            audit: (d) => {
              details = { ...details, ...d };
            },
          },
          parsed.data,
        );

        // 5) Audit, dans la même transaction que l'action
        await tx.insert(schema.auditLog).values({
          tenantId,
          actorUserId: user.id,
          action: options.audit,
          entityType: details.entityType ?? null,
          entityId: details.entityId ?? null,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          before: details.before === undefined ? null : maskPII(details.before),
          after: details.after === undefined ? null : maskPII(details.after),
        });
        return result;
      });
      return { ok: true, data };
    } catch (e) {
      if (e instanceof Denied) {
        if (e.error.code === "FORBIDDEN" || e.error.code === "TWO_FACTOR_REQUIRED") {
          await auditDenied(db, ctx, options.audit, e.error);
        }
        return { ok: false, error: e.error };
      }
      const conflict = uniqueViolation(e);
      if (conflict) return { ok: false, error: conflict };
      log("error", "échec d'une action", {
        action: options.audit,
        tenantId: ctx.tenantId,
        error: e,
      });
      return { ok: false, error: { code: "INTERNAL" } };
    }
  };
}

export interface UserActionContext {
  tx: Tx;
  userId: string;
}

/**
 * Action d'un utilisateur connecté hors entreprise (ex. créer sa première entreprise).
 * L'audit est écrit dans la transaction ; `tenantId` renvoyé par le handler le rattache à l'entreprise.
 */
export function createUserAction<S extends z.ZodType, T>(
  db: Db,
  options: { input: S; audit: string },
  handler: (
    ctx: UserActionContext,
    input: z.infer<S>,
  ) => Promise<{ data: T; tenantId?: string; entityId?: string }>,
) {
  return async (ctx: RequestContext, rawInput: unknown): Promise<ActionResult<T>> => {
    const user = ctx.user;
    if (!user) return { ok: false, error: { code: "UNAUTHENTICATED" } };
    const parsed = options.input.safeParse(rawInput);
    if (!parsed.success) return { ok: false, error: invalidInput(parsed.error) };
    try {
      const data = await withUser(db, user.id, async (tx) => {
        const out = await handler({ tx, userId: user.id }, parsed.data);
        await tx.insert(schema.auditLog).values({
          tenantId: out.tenantId ?? null,
          actorUserId: user.id,
          action: options.audit,
          entityId: out.entityId ?? out.tenantId ?? null,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
        return out.data;
      });
      return { ok: true, data };
    } catch (e) {
      const conflict = uniqueViolation(e);
      if (conflict) return { ok: false, error: conflict };
      log("error", "échec d'une action", { action: options.audit, error: e });
      return { ok: false, error: { code: "INTERNAL" } };
    }
  };
}
