import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  acceptInvitation,
  createTenantWithOwner,
  eq,
  findInvitationByToken,
  newInvitationToken,
  withTenant,
  withUser,
  type NewTenant,
} from "../src";
import { invitations, memberships, tenants, users } from "../src/schema";
import { db } from "./db";

const fake = (n: string): NewTenant => ({
  legalName: `Société fictive ${n}`,
  niu: `I0000000000${n}`,
  cnpsEmployerNumber: `000-000000-${n}`,
  regime: "general",
  workAccidentRate: 175,
  commune: "Bafoussam 1er",
});

const owner = "inv-owner";
const ownerB = "inv-owner-b";
const invitee = "inv-invitee";
let tenantA = "";
let tenantB = "";

async function invite(
  opts: { email?: string; expiresInMs?: number; tenant?: string; by?: string } = {},
) {
  const { token, tokenHash } = newInvitationToken();
  const tenantId = opts.tenant ?? tenantA;
  await withTenant(db, { tenantId, userId: opts.by ?? owner }, (tx) =>
    tx.insert(invitations).values({
      tenantId,
      email: opts.email ?? "invite.fictif@exemple.test",
      role: "accountant",
      tokenHash,
      invitedBy: opts.by ?? owner,
      expiresAt: new Date(Date.now() + (opts.expiresInMs ?? 7 * 24 * 3600 * 1000)),
    }),
  );
  return token;
}

const accept = (token: string, email = "Invite.Fictif@exemple.test", userId = invitee) =>
  withUser(db, userId, (tx) => acceptInvitation(tx, { token, userId, email }));

beforeAll(async () => {
  await db.insert(users).values(
    [owner, ownerB, invitee, "inv-other"].map((id) => ({
      id,
      name: id,
      email: `${id}@exemple.test`,
    })),
  );
  tenantA = await withUser(db, owner, (tx) => createTenantWithOwner(tx, owner, fake("A")));
  tenantB = await withUser(db, ownerB, (tx) => createTenantWithOwner(tx, ownerB, fake("B")));
});

afterAll(async () => {
  await db.$client.end();
});

describe("isolation des invitations", () => {
  it("sans jeton ni entreprise, aucune invitation n'est visible", async () => {
    await invite();
    expect(await withUser(db, invitee, (tx) => tx.select().from(invitations))).toHaveLength(0);
  });

  it("B ne voit pas les invitations de A", async () => {
    const rows = await withTenant(db, { tenantId: tenantB, userId: ownerB }, (tx) =>
      tx.select().from(invitations),
    );
    expect(rows).toHaveLength(0);
  });

  it("le jeton ne révèle que son invitation et le nom de l'entreprise", async () => {
    const token = await invite();
    const view = await withUser(db, invitee, (tx) => findInvitationByToken(tx, token));
    expect(view).toMatchObject({
      tenantId: tenantA,
      tenantName: "Société fictive A",
      status: "pending",
    });
    const visible = await withUser(db, invitee, async (tx) => {
      await findInvitationByToken(tx, token);
      return { inv: await tx.select().from(invitations), ten: await tx.select().from(tenants) };
    });
    expect(visible.inv).toHaveLength(1);
    expect(visible.ten.map((t) => t.id)).toEqual([tenantA]);
  });

  it("un jeton inconnu ne donne rien", async () => {
    expect(await withUser(db, invitee, (tx) => findInvitationByToken(tx, "inconnu"))).toBeNull();
  });

  it("une invitation ne peut pas être créée hors de l'entreprise courante", async () => {
    const { tokenHash } = newInvitationToken();
    await expect(
      withTenant(db, { tenantId: tenantB, userId: ownerB }, (tx) =>
        tx.insert(invitations).values({
          tenantId: tenantA,
          email: "x@exemple.test",
          role: "accountant",
          tokenHash,
          invitedBy: ownerB,
          expiresAt: new Date(Date.now() + 1000),
        }),
      ),
    ).rejects.toThrow();
  });
});

describe("acceptation", () => {
  it("crée l'appartenance avec le rôle invité, une seule fois", async () => {
    const token = await invite();
    expect(await accept(token)).toEqual({ ok: true, tenantId: tenantA });
    const [m] = await withTenant(db, { tenantId: tenantA, userId: owner }, (tx) =>
      tx.select().from(memberships).where(eq(memberships.userId, invitee)),
    );
    expect(m?.role).toBe("accountant");
    expect(await accept(token, "invite.fictif@exemple.test", "inv-other")).toEqual({
      ok: false,
      reason: "accepted",
    });
  });

  it("refuse une autre adresse e-mail", async () => {
    const token = await invite({ email: "quelquun@exemple.test" });
    expect(await accept(token, "autre@exemple.test", "inv-other")).toEqual({
      ok: false,
      reason: "email_mismatch",
    });
  });

  it("refuse une invitation expirée, révoquée ou inconnue", async () => {
    const expired = await invite({ email: "inv-other@exemple.test", expiresInMs: -1000 });
    expect(await accept(expired, "inv-other@exemple.test", "inv-other")).toEqual({
      ok: false,
      reason: "expired",
    });
    const revoked = await invite({ email: "inv-other@exemple.test" });
    await withTenant(db, { tenantId: tenantA, userId: owner }, (tx) =>
      tx.update(invitations).set({ revokedAt: new Date() }),
    );
    expect(await accept(revoked, "inv-other@exemple.test", "inv-other")).toEqual({
      ok: false,
      reason: "revoked",
    });
    expect(await accept("inconnu")).toEqual({ ok: false, reason: "not_found" });
  });

  it("refuse un membre déjà présent", async () => {
    const token = await invite({ email: `${owner}@exemple.test` });
    expect(await accept(token, `${owner}@exemple.test`, owner)).toEqual({
      ok: false,
      reason: "already_member",
    });
  });

  it("deux acceptations simultanées : une seule réussit", async () => {
    await db.insert(users).values([
      { id: "inv-race-1", name: "r1", email: "r1@exemple.test" },
      { id: "inv-race-2", name: "r2", email: "r2@exemple.test" },
    ]);
    const token = await invite({ email: "race@exemple.test" });
    const results = await Promise.allSettled([
      accept(token, "race@exemple.test", "inv-race-1"),
      accept(token, "race@exemple.test", "inv-race-2"),
    ]);
    const oks = results.filter((r) => r.status === "fulfilled" && r.value.ok);
    expect(oks).toHaveLength(1);
  });
});
