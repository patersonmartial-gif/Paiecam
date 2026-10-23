import { z } from "zod";
import {
  acceptInvitation,
  and,
  eq,
  gt,
  isNull,
  newInvitationToken,
  schema,
  type Db,
} from "@paiecam/db";
import { createTenantAction, createUserAction, RuleError } from "../authz/action";
import type { Mailer } from "../mail";

const INVITATION_DAYS = 7;
/** Plafond d'invitations par entreprise et par heure (anti-abus : envoi d'e-mails depuis notre domaine). */
export const INVITATIONS_PER_HOUR = 20;
const assignableRole = z.enum(["payroll_manager", "accountant"]);

export function makeListMembers(db: Db) {
  return createTenantAction(
    db,
    { permission: "members:read", input: z.object({}), audit: "members.list", skipAudit: true },
    async ({ tx }) => {
      const members = await tx
        .select({
          membershipId: schema.memberships.id,
          userId: schema.memberships.userId,
          role: schema.memberships.role,
          name: schema.users.name,
          email: schema.users.email,
        })
        .from(schema.memberships)
        .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
        .orderBy(schema.memberships.createdAt);
      const pending = await tx
        .select({
          id: schema.invitations.id,
          email: schema.invitations.email,
          role: schema.invitations.role,
          expiresAt: schema.invitations.expiresAt,
        })
        .from(schema.invitations)
        .where(
          and(
            isNull(schema.invitations.acceptedAt),
            isNull(schema.invitations.revokedAt),
            gt(schema.invitations.expiresAt, new Date()),
          ),
        )
        .orderBy(schema.invitations.createdAt);
      return { members, pending };
    },
  );
}

export function makeInvite(db: Db, deps: { mailer: Mailer; baseURL: string }) {
  return createTenantAction(
    db,
    {
      permission: "members:manage",
      input: z.object({
        email: z.string().trim().toLowerCase().pipe(z.email()),
        role: assignableRole,
      }),
      audit: "members.invite",
    },
    async ({ tx, userId, tenantId, audit }, input) => {
      const recent = await tx
        .select({ id: schema.invitations.id })
        .from(schema.invitations)
        .where(gt(schema.invitations.createdAt, new Date(Date.now() - 3600_000)));
      if (recent.length >= INVITATIONS_PER_HOUR) throw new RuleError("rate_limited");
      const already = await tx
        .select({ id: schema.memberships.id })
        .from(schema.memberships)
        .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
        .where(eq(schema.users.email, input.email));
      if (already.length > 0) throw new RuleError("already_member");

      // Une seule invitation en attente par adresse : la précédente est révoquée.
      await tx
        .update(schema.invitations)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(schema.invitations.email, input.email),
            isNull(schema.invitations.acceptedAt),
            isNull(schema.invitations.revokedAt),
          ),
        );

      const { token, tokenHash } = newInvitationToken();
      const [inv] = await tx
        .insert(schema.invitations)
        .values({
          tenantId,
          email: input.email,
          role: input.role,
          tokenHash,
          invitedBy: userId,
          expiresAt: new Date(Date.now() + INVITATION_DAYS * 24 * 3600 * 1000),
        })
        .returning({ id: schema.invitations.id });
      const [tenant] = await tx.select({ name: schema.tenants.legalName }).from(schema.tenants);

      // Envoi dans la transaction : si l'e-mail échoue, l'invitation n'existe pas.
      await deps.mailer.send({
        to: input.email,
        subject: `Invitation à rejoindre ${tenant?.name ?? "une entreprise"} sur PaieCam`,
        text: `Vous êtes invité(e) sur PaieCam. Ce lien est valable ${INVITATION_DAYS} jours et ne sert qu'une fois :\n${deps.baseURL}/invitation/${token}`,
      });
      audit({
        entityType: "invitation",
        entityId: inv?.id ?? "",
        after: { email: input.email, role: input.role },
      });
      return { invitationId: inv?.id ?? "" };
    },
  );
}

export function makeRevokeInvitation(db: Db) {
  return createTenantAction(
    db,
    {
      permission: "members:manage",
      input: z.object({ invitationId: z.uuid() }),
      audit: "members.revoke_invitation",
    },
    async ({ tx, audit }, input) => {
      const updated = await tx
        .update(schema.invitations)
        .set({ revokedAt: new Date() })
        .where(
          and(eq(schema.invitations.id, input.invitationId), isNull(schema.invitations.acceptedAt)),
        )
        .returning({ id: schema.invitations.id });
      if (updated.length === 0) throw new RuleError("not_found");
      audit({ entityType: "invitation", entityId: input.invitationId });
      return { revoked: true };
    },
  );
}

async function targetMembership(
  tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
  membershipId: string,
) {
  const [m] = await tx
    .select()
    .from(schema.memberships)
    .where(eq(schema.memberships.id, membershipId));
  if (!m) throw new RuleError("not_found");
  return m;
}

export function makeChangeRole(db: Db) {
  return createTenantAction(
    db,
    {
      permission: "members:manage",
      input: z.object({ membershipId: z.uuid(), role: assignableRole }),
      audit: "members.change_role",
    },
    async ({ tx, userId, audit }, input) => {
      const m = await targetMembership(tx, input.membershipId);
      if (m.userId === userId) throw new RuleError("self");
      if (m.role === "owner") throw new RuleError("owner");
      await tx
        .update(schema.memberships)
        .set({ role: input.role })
        .where(eq(schema.memberships.id, m.id));
      audit({
        entityType: "membership",
        entityId: m.id,
        before: { role: m.role },
        after: { role: input.role },
      });
      return { membershipId: m.id };
    },
  );
}

export function makeRemoveMember(db: Db) {
  return createTenantAction(
    db,
    {
      permission: "members:manage",
      input: z.object({ membershipId: z.uuid() }),
      audit: "members.remove",
    },
    async ({ tx, userId, audit }, input) => {
      const m = await targetMembership(tx, input.membershipId);
      if (m.userId === userId) throw new RuleError("self");
      if (m.role === "owner") throw new RuleError("owner");
      await tx.delete(schema.memberships).where(eq(schema.memberships.id, m.id));
      audit({
        entityType: "membership",
        entityId: m.id,
        before: { userId: m.userId, role: m.role },
      });
      return { removed: true };
    },
  );
}

export function makeAcceptInvitation(db: Db) {
  return createUserAction(
    db,
    {
      input: z.object({ token: z.string().min(20).max(100), email: z.string() }),
      audit: "members.joined",
    },
    async ({ tx, userId }, input) => {
      const result = await acceptInvitation(tx, { token: input.token, userId, email: input.email });
      if (!result.ok) throw new RuleError(result.reason);
      return { data: { tenantId: result.tenantId }, tenantId: result.tenantId };
    },
  );
}
