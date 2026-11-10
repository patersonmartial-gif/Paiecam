import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { invitations, memberships, tenants } from "./schema";
import type { Tx } from "./tenant";

/** Jeton de 256 bits transmis par e-mail ; seule son empreinte est stockée. */
export function newInvitationToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInvitationToken(token) };
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface InvitationView {
  id: string;
  tenantId: string;
  tenantName: string;
  email: string;
  role: "payroll_manager" | "accountant" | "cashier" | "stock_manager";
  status: "pending" | "accepted" | "revoked" | "expired";
}

/** Lit une invitation par son jeton. À appeler dans withUser(). */
export async function findInvitationByToken(tx: Tx, token: string): Promise<InvitationView | null> {
  await tx.execute(
    sql`select set_config('app.invitation_token_hash', ${hashInvitationToken(token)}, true)`,
  );
  const [row] = await tx
    .select({
      id: invitations.id,
      tenantId: invitations.tenantId,
      tenantName: tenants.legalName,
      email: invitations.email,
      role: invitations.role,
      acceptedAt: invitations.acceptedAt,
      revokedAt: invitations.revokedAt,
      expiresAt: invitations.expiresAt,
    })
    .from(invitations)
    .innerJoin(tenants, eq(tenants.id, invitations.tenantId))
    .where(eq(invitations.tokenHash, hashInvitationToken(token)));
  if (!row) return null;
  const status = row.acceptedAt
    ? "accepted"
    : row.revokedAt
      ? "revoked"
      : row.expiresAt <= new Date()
        ? "expired"
        : "pending";
  return {
    id: row.id,
    tenantId: row.tenantId,
    tenantName: row.tenantName,
    email: row.email,
    role: row.role,
    status,
  };
}

export type AcceptResult =
  | { ok: true; tenantId: string }
  | {
      ok: false;
      reason:
        "not_found" | "accepted" | "revoked" | "expired" | "email_mismatch" | "already_member";
    };

/**
 * Accepte une invitation pour l'utilisateur connecté. À appeler dans withUser().
 * L'adresse du compte doit être celle de l'invitation, et le jeton ne sert qu'une fois.
 */
export async function acceptInvitation(
  tx: Tx,
  input: { token: string; userId: string; email: string },
): Promise<AcceptResult> {
  const invitation = await findInvitationByToken(tx, input.token);
  if (!invitation) return { ok: false, reason: "not_found" };
  if (invitation.status !== "pending") return { ok: false, reason: invitation.status };
  if (invitation.email !== input.email.trim().toLowerCase()) {
    return { ok: false, reason: "email_mismatch" };
  }

  await tx.execute(sql`select set_config('app.tenant_id', ${invitation.tenantId}, true)`);
  const existing = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(eq(memberships.tenantId, invitation.tenantId), eq(memberships.userId, input.userId)),
    );
  if (existing.length > 0) return { ok: false, reason: "already_member" };

  // Mise à jour conditionnelle : si deux acceptations se croisent, une seule passe.
  const claimed = await tx
    .update(invitations)
    .set({ acceptedAt: new Date(), acceptedBy: input.userId })
    .where(
      and(
        eq(invitations.id, invitation.id),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    )
    .returning({ id: invitations.id });
  if (claimed.length === 0) return { ok: false, reason: "accepted" };

  await tx
    .insert(memberships)
    .values({ tenantId: invitation.tenantId, userId: input.userId, role: invitation.role });
  return { ok: true, tenantId: invitation.tenantId };
}
