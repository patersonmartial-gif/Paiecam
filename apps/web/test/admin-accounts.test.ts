import { afterAll, describe, expect, it } from "vitest";
import { createDb, eq, schema } from "@paiecam/db";
import { testDatabaseUrl, testOpsDatabaseUrl } from "@paiecam/db/testing";
import { resetPassword, resetTwoFactor, temporaryPassword } from "@/server/admin/accounts";
import { createAuth } from "@/server/auth/config";

const db = createDb(testDatabaseUrl());
const ops = createDb(testOpsDatabaseUrl());
const baseURL = "http://localhost:3000";
const auth = createAuth({
  db,
  secret: "a".repeat(32),
  baseURL,
  mailer: { enabled: false, send: async () => {} },
  checkPwnedPasswords: false,
});
const post = (path: string, body: unknown) =>
  auth.handler(
    new Request(`${baseURL}/api/auth${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: baseURL,
        "x-paiecam-client-ip": "203.0.113.200",
      },
      body: JSON.stringify(body),
    }),
  );
const email = "admin-local@exemple.test";
const original = "phrase-de-passe-originale";

afterAll(async () => {
  await db.$client.end();
  await ops.$client.end();
});

describe("dépannage local des comptes (paiecam-admin)", () => {
  it("mot de passe provisoire robuste et lisible", () => {
    const p = temporaryPassword();
    expect(p).toMatch(/^[a-km-z2-9]{4}(-[a-km-z2-9]{4}){4}$/);
    expect(p).not.toMatch(/[01ilo]/);
    expect(temporaryPassword()).not.toBe(p);
  });

  it("réinitialisation : nouveau mot de passe valable, ancien refusé, sessions fermées, tracé", async () => {
    expect((await post("/sign-up/email", { email, password: original, name: "A" })).status).toBe(
      200,
    );
    const [u] = await db.select().from(schema.users).where(eq(schema.users.email, email));
    expect(
      await db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.userId, u?.id ?? "")),
    ).not.toHaveLength(0);

    const temp = await resetPassword(db, "  Admin-Local@Exemple.test ");
    expect(
      await db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.userId, u?.id ?? "")),
    ).toHaveLength(0);
    expect((await post("/sign-in/email", { email, password: original })).status).toBe(401);
    expect((await post("/sign-in/email", { email, password: temp })).status).toBe(200);
    const events = await ops
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.actorUserId, u?.id ?? ""));
    expect(events.map((e) => e.action)).toContain("admin.password_reset");
    await expect(resetPassword(db, "inconnu@exemple.test")).rejects.toThrow(/aucun compte/);
  });

  it("double authentification retirée : drapeau, secret et sessions supprimés", async () => {
    const [u] = await db.select().from(schema.users).where(eq(schema.users.email, email));
    await db
      .update(schema.users)
      .set({ twoFactorEnabled: true })
      .where(eq(schema.users.id, u?.id ?? ""));
    await resetTwoFactor(db, email);
    const [after] = await db.select().from(schema.users).where(eq(schema.users.email, email));
    expect(after?.twoFactorEnabled).toBe(false);
    expect(
      await db
        .select()
        .from(schema.twoFactors)
        .where(eq(schema.twoFactors.userId, u?.id ?? "")),
    ).toHaveLength(0);
  });
});
