import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDb,
  createTenantWithOwner,
  eq,
  schema,
  sql,
  withTenant,
  withUser,
  type NewTenant,
} from "@paiecam/db";
import { testDatabaseUrl } from "@paiecam/db/testing";
import type { RequestContext } from "@/server/authz/action";
import { makeGetCompany, makeUpdateCompany } from "@/server/features/company";
import {
  makeAcceptInvitation,
  makeChangeRole,
  makeInvite,
  makeListMembers,
  makeRemoveMember,
  makeRevokeInvitation,
} from "@/server/features/members";
import type { Mail } from "@/server/mail";
import { MASK } from "@/server/log";

const db = createDb(testDatabaseUrl());
const sent: Mail[] = [];
const mailer = { enabled: true, send: async (m: Mail) => void sent.push(m) };

const invite = makeInvite(db, { mailer, baseURL: "http://localhost:3000" });
const list = makeListMembers(db);
const accept = makeAcceptInvitation(db);
const changeRole = makeChangeRole(db);
const remove = makeRemoveMember(db);
const revoke = makeRevokeInvitation(db);
const getCompany = makeGetCompany(db);
const updateCompany = makeUpdateCompany(db);

const fake = (n: string): NewTenant => ({
  legalName: `Cabinet fictif ${n}`,
  niu: `C0000000000${n}`,
  cnpsEmployerNumber: `000-000000-${n}`,
  regime: "general",
  workAccidentRate: 250,
  commune: "Garoua 2e",
});

const U = {
  ownerA: "mem-owner-a",
  managerA: "mem-manager-a",
  ownerB: "mem-owner-b",
  newcomer: "mem-newcomer",
};
const email = (id: string) => `${id}@exemple.test`;
let tenantA = "";
let tenantB = "";

const ctx = (
  userId: string | null,
  tenantId: string | null,
  twoFactorEnabled = true,
): RequestContext => ({
  user: userId ? { id: userId, twoFactorEnabled } : null,
  tenantId,
  ip: "203.0.113.20",
  userAgent: "vitest",
});

const tokenOf = (mail: Mail | undefined) =>
  /\/invitation\/([\w-]+)/.exec(mail?.text ?? "")?.[1] ?? "";

async function membershipOf(tenantId: string, ownerId: string, userId: string) {
  const [m] = await withTenant(db, { tenantId, userId: ownerId }, (tx) =>
    tx.select().from(schema.memberships).where(eq(schema.memberships.userId, userId)),
  );
  return m;
}

beforeAll(async () => {
  await db
    .insert(schema.users)
    .values(Object.values(U).map((id) => ({ id, name: id, email: email(id) })));
  tenantA = await withUser(db, U.ownerA, (tx) => createTenantWithOwner(tx, U.ownerA, fake("A")));
  tenantB = await withUser(db, U.ownerB, (tx) => createTenantWithOwner(tx, U.ownerB, fake("B")));
  await withTenant(db, { tenantId: tenantA, userId: U.ownerA }, (tx) =>
    tx
      .insert(schema.memberships)
      .values({ tenantId: tenantA, userId: U.managerA, role: "payroll_manager" }),
  );
});

afterAll(async () => {
  await db.$client.end();
});

describe("invitation d'un collaborateur", () => {
  it("le propriétaire invite, l'e-mail contient un lien à usage unique", async () => {
    sent.length = 0;
    const res = await invite(ctx(U.ownerA, tenantA), {
      email: "  Mem-Newcomer@Exemple.test ",
      role: "accountant",
    });
    expect(res.ok).toBe(true);
    expect(sent[0]?.to).toBe(email(U.newcomer));
    expect(tokenOf(sent[0])).toHaveLength(43);
    const listed = await list(ctx(U.ownerA, tenantA), {});
    expect(listed.ok && listed.data.pending.map((p) => p.email)).toEqual([email(U.newcomer)]);
  });

  it("sans e-mail (installation locale) : le lien est remis à celui qui invite, rien n'est envoyé", async () => {
    sent.length = 0;
    const offline = makeInvite(db, {
      mailer: { enabled: false, send: async () => Promise.reject(new Error("désactivé")) },
      baseURL: "http://localhost:3000",
    });
    const res = await offline(ctx(U.ownerA, tenantA), {
      email: "hors-ligne@exemple.test",
      role: "accountant",
    });
    expect(res.ok && res.data.link).toMatch(/^http:\/\/localhost:3000\/invitation\/[\w-]{43}$/);
    expect(sent).toEqual([]);
    // Avec e-mail, le lien n'est jamais renvoyé à l'écran.
    const withMail = await invite(ctx(U.ownerA, tenantA), {
      email: "avec-mail@exemple.test",
      role: "accountant",
    });
    expect(withMail.ok && "link" in withMail.data).toBe(false);
  });

  it("l'audit ne contient pas l'adresse en clair, la base ne contient pas le jeton", async () => {
    const rows = await withTenant(db, { tenantId: tenantA, userId: U.ownerA }, (tx) =>
      tx.execute<{ after: { email: string }; token_hash: string }>(
        sql`select a.after, i.token_hash from audit_log a, invitations i where a.action = 'members.invite'`,
      ),
    );
    expect(rows[0]?.after.email).toBe(MASK);
    expect(rows[0]?.token_hash).not.toBe(tokenOf(sent[0]));
  });

  it("le gestionnaire paie ne peut pas inviter", async () => {
    expect(
      await invite(ctx(U.managerA, tenantA), { email: "x@exemple.test", role: "accountant" }),
    ).toEqual({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });

  it("refuse d'inviter un membre existant", async () => {
    expect(
      await invite(ctx(U.ownerA, tenantA), { email: email(U.managerA), role: "accountant" }),
    ).toEqual({
      ok: false,
      error: { code: "RULE", reason: "already_member" },
    });
  });

  it("une nouvelle invitation remplace la précédente", async () => {
    sent.length = 0;
    await invite(ctx(U.ownerA, tenantA), { email: "double@exemple.test", role: "accountant" });
    const first = tokenOf(sent[0]);
    await invite(ctx(U.ownerA, tenantA), { email: "double@exemple.test", role: "payroll_manager" });
    await db
      .insert(schema.users)
      .values({ id: "mem-double", name: "d", email: "double@exemple.test" });
    expect(
      await accept(ctx("mem-double", null), { token: first, email: "double@exemple.test" }),
    ).toEqual({
      ok: false,
      error: { code: "RULE", reason: "revoked" },
    });
    expect(
      (
        await accept(ctx("mem-double", null), {
          token: tokenOf(sent[1]),
          email: "double@exemple.test",
        })
      ).ok,
    ).toBe(true);
    expect((await membershipOf(tenantA, U.ownerA, "mem-double"))?.role).toBe("payroll_manager");
  });

  it("l'invité accepte avec la bonne adresse et obtient le rôle prévu", async () => {
    sent.length = 0;
    await invite(ctx(U.ownerA, tenantA), { email: email(U.newcomer), role: "accountant" });
    const token = tokenOf(sent[0]);
    expect(await accept(ctx(U.newcomer, null), { token, email: "autre@exemple.test" })).toEqual({
      ok: false,
      error: { code: "RULE", reason: "email_mismatch" },
    });
    expect(await accept(ctx(U.newcomer, null, false), { token, email: email(U.newcomer) })).toEqual(
      {
        ok: true,
        data: { tenantId: tenantA },
      },
    );
    expect((await membershipOf(tenantA, U.ownerA, U.newcomer))?.role).toBe("accountant");
    // Le comptable lit sans 2FA, mais ne modifie rien.
    expect((await getCompany(ctx(U.newcomer, tenantA, false), {})).ok).toBe(true);
    expect(await updateCompany(ctx(U.newcomer, tenantA, false), fake("A"))).toEqual({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });

  it("une invitation révoquée n'est plus utilisable", async () => {
    sent.length = 0;
    const res = await invite(ctx(U.ownerA, tenantA), {
      email: "revoque@exemple.test",
      role: "accountant",
    });
    const invitationId = res.ok ? res.data.invitationId : "";
    expect((await revoke(ctx(U.ownerA, tenantA), { invitationId })).ok).toBe(true);
    await db
      .insert(schema.users)
      .values({ id: "mem-revoque", name: "r", email: "revoque@exemple.test" });
    expect(
      await accept(ctx("mem-revoque", null), {
        token: tokenOf(sent[0]),
        email: "revoque@exemple.test",
      }),
    ).toEqual({
      ok: false,
      error: { code: "RULE", reason: "revoked" },
    });
  });
});

describe("gestion des membres", () => {
  it("le propriétaire change un rôle, mais ni le sien ni celui d'un propriétaire", async () => {
    const manager = await membershipOf(tenantA, U.ownerA, U.managerA);
    const owner = await membershipOf(tenantA, U.ownerA, U.ownerA);
    expect(
      (await changeRole(ctx(U.ownerA, tenantA), { membershipId: manager?.id, role: "accountant" }))
        .ok,
    ).toBe(true);
    expect((await membershipOf(tenantA, U.ownerA, U.managerA))?.role).toBe("accountant");
    expect(
      await changeRole(ctx(U.ownerA, tenantA), { membershipId: owner?.id, role: "accountant" }),
    ).toEqual({
      ok: false,
      error: { code: "RULE", reason: "self" },
    });
  });

  it("anti-IDOR : le propriétaire de B ne peut ni modifier ni retirer un membre de A", async () => {
    const manager = await membershipOf(tenantA, U.ownerA, U.managerA);
    expect(
      await changeRole(ctx(U.ownerB, tenantB), {
        membershipId: manager?.id,
        role: "payroll_manager",
      }),
    ).toEqual({
      ok: false,
      error: { code: "RULE", reason: "not_found" },
    });
    expect(await remove(ctx(U.ownerB, tenantB), { membershipId: manager?.id })).toEqual({
      ok: false,
      error: { code: "RULE", reason: "not_found" },
    });
    expect(await membershipOf(tenantA, U.ownerA, U.managerA)).toBeDefined();
  });

  it("le propriétaire retire un membre, mais pas lui-même", async () => {
    const manager = await membershipOf(tenantA, U.ownerA, U.managerA);
    const owner = await membershipOf(tenantA, U.ownerA, U.ownerA);
    expect(await remove(ctx(U.ownerA, tenantA), { membershipId: owner?.id })).toEqual({
      ok: false,
      error: { code: "RULE", reason: "self" },
    });
    expect((await remove(ctx(U.ownerA, tenantA), { membershipId: manager?.id })).ok).toBe(true);
    expect(await membershipOf(tenantA, U.ownerA, U.managerA)).toBeUndefined();
    // Retiré, il n'a plus accès.
    expect(await getCompany(ctx(U.managerA, tenantA), {})).toEqual({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });
});

describe("fiche entreprise", () => {
  it("le propriétaire modifie la fiche, l'audit masque le NIU", async () => {
    const res = await updateCompany(ctx(U.ownerA, tenantA), {
      ...fake("A"),
      legalName: "Cabinet fictif A2",
    });
    expect(res.ok).toBe(true);
    const [row] = await withTenant(db, { tenantId: tenantA, userId: U.ownerA }, (tx) =>
      tx.execute<{ before: Record<string, unknown>; after: Record<string, unknown> }>(
        sql`select before, after from audit_log where action = 'tenant.update'`,
      ),
    );
    expect(row?.before).toMatchObject({
      legalName: "Cabinet fictif A",
      niu: MASK,
      cnpsEmployerNumber: MASK,
    });
    expect(row?.after).toMatchObject({ legalName: "Cabinet fictif A2" });
  });

  it("refuse le NIU d'une autre entreprise", async () => {
    expect(
      await updateCompany(ctx(U.ownerA, tenantA), { ...fake("A"), niu: fake("B").niu }),
    ).toEqual({
      ok: false,
      error: { code: "CONFLICT", constraint: "tenants_niu_key" },
    });
  });
});

describe("limite d'invitations", () => {
  it(`au-delà de ${20} invitations par heure, refus`, async () => {
    const { INVITATIONS_PER_HOUR } = await import("@/server/features/members");
    const existing = await withTenant(
      db,
      { tenantId: tenantA, userId: U.ownerA },
      async (tx) => (await tx.select().from(schema.invitations)).length,
    );
    for (let i = existing; i < INVITATIONS_PER_HOUR; i++) {
      expect(
        (
          await invite(ctx(U.ownerA, tenantA), {
            email: `limite.${i}@exemple.test`,
            role: "accountant",
          })
        ).ok,
      ).toBe(true);
    }
    expect(
      await invite(ctx(U.ownerA, tenantA), {
        email: "une.de.trop@exemple.test",
        role: "accountant",
      }),
    ).toEqual({
      ok: false,
      error: { code: "RULE", reason: "rate_limited" },
    });
  });
});
