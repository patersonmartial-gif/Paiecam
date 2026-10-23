import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, eq, schema, sql } from "@paiecam/db";
import { testDatabaseUrl, testOpsDatabaseUrl } from "@paiecam/db/testing";
import { createAuth } from "@/server/auth/config";
import type { Mail } from "@/server/mail";

const db = createDb(testDatabaseUrl());
/** Rôle de supervision : seul à lire les événements hors entreprise. */
const ops = createDb(testOpsDatabaseUrl());
const sent: Mail[] = [];
const baseURL = "http://localhost:3000";
const makeAuth = (checkPwnedPasswords = false) =>
  createAuth({
    db,
    secret: "s".repeat(32),
    baseURL,
    mailer: { send: async (m) => void sent.push(m) },
    checkPwnedPasswords,
  });
const auth = makeAuth();

let ipCounter = 0;
/** Une IP différente par test : les compteurs de rate limiting ne débordent pas d'un test à l'autre. */
let ip = "";
beforeEach(() => {
  ip = `203.0.113.${++ipCounter}`;
  sent.length = 0;
});

function post(path: string, body: unknown, a = auth) {
  return a.handler(
    new Request(`${baseURL}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseURL, "x-paiecam-client-ip": ip },
      body: JSON.stringify(body),
    }),
  );
}

function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("valeur attendue");
  return value;
}

async function userByEmail(email: string) {
  return must((await db.select().from(schema.users).where(eq(schema.users.email, email)))[0]);
}

const password = "correct-horse-battery-staple";
let n = 0;
const newEmail = () => `salarie.fictif.${++n}@exemple.test`;

afterAll(async () => {
  await db.$client.end();
  await ops.$client.end();
});

describe("inscription", () => {
  it("refuse un mot de passe de moins de 12 caractères", async () => {
    const res = await post("/sign-up/email", {
      email: newEmail(),
      password: "court-11car",
      name: "A",
    });
    expect(res.status).toBe(400);
  });

  it("stocke le mot de passe en Argon2id, jamais en clair", async () => {
    const email = newEmail();
    const res = await post("/sign-up/email", { email, password, name: "Utilisateur fictif" });
    expect(res.status).toBe(200);
    const user = await userByEmail(email);
    const [account] = await db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.userId, user.id));
    expect(account?.password).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(account?.password).not.toContain(password);
    expect(user.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
  });

  it("refuse un mot de passe présent dans une fuite (Have I Been Pwned, k-anonymat)", async () => {
    const leaked = "motdepasse-deja-fuite";
    const sha1 = createHash("sha1").update(leaked).digest("hex").toUpperCase();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(`${sha1.slice(5)}:1234\r\n0000000000000000000000000000000000A:1`),
      );
    try {
      const res = await post(
        "/sign-up/email",
        { email: newEmail(), password: leaked, name: "A" },
        makeAuth(true),
      );
      expect(res.status).toBe(400);
      expect(await res.text()).toMatch(/fuite de données/);
      // Seuls les 5 premiers caractères du hash quittent le serveur.
      const calledUrl = String(fetchSpy.mock.calls[0]?.[0]);
      expect(calledUrl).toContain(sha1.slice(0, 5));
      expect(calledUrl).not.toContain(sha1.slice(5));
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe("connexion et session", () => {
  it("pose un cookie de session HttpOnly, SameSite=Lax, valable 8 h", async () => {
    const email = newEmail();
    await post("/sign-up/email", { email, password, name: "A" });
    const res = await post("/sign-in/email", { email, password });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/better-auth\.session_token=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Max-Age=28800/);
  });

  it("régénère le jeton à chaque connexion", async () => {
    const email = newEmail();
    await post("/sign-up/email", { email, password, name: "A" });
    const token = async () =>
      /session_token=([^;]+)/.exec(
        (await post("/sign-in/email", { email, password })).headers.get("set-cookie") ?? "",
      )?.[1];
    const first = await token();
    const second = await token();
    expect(first).toBeTruthy();
    expect(second).not.toBe(first);
  });

  it("refuse un mauvais mot de passe sans dire si le compte existe", async () => {
    const email = newEmail();
    await post("/sign-up/email", { email, password, name: "A" });
    const wrong = await post("/sign-in/email", { email, password: "mauvais-mot-de-passe" });
    const unknown = await post("/sign-in/email", { email: newEmail(), password });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
  });

  it("bloque après 5 tentatives de connexion par minute", async () => {
    const email = newEmail();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push(
        (await post("/sign-in/email", { email, password: "mauvais-mot-de-passe" })).status,
      );
    }
    expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true);
    expect(statuses[5]).toBe(429);
  });

  it("refuse une requête venant d'une autre origine (CSRF)", async () => {
    const res = await auth.handler(
      new Request(`${baseURL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://site-malveillant.example",
          cookie: "better-auth.session_token=x",
          "x-paiecam-client-ip": ip,
        },
        body: JSON.stringify({ email: newEmail(), password }),
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe("réinitialisation du mot de passe", () => {
  it("envoie un lien et révoque les sessions existantes", async () => {
    const email = newEmail();
    await post("/sign-up/email", { email, password, name: "A" });
    await post("/sign-in/email", { email, password });
    const res = await post("/request-password-reset", { email, redirectTo: "/reinitialiser" });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    const token = /reset-password\/([^?\s]+)/.exec(must(sent[0]).text)?.[1];
    expect(token).toBeTruthy();

    const reset = await post("/reset-password", { token, newPassword: "un-nouveau-mot-de-passe" });
    expect(reset.status).toBe(200);
    const user = await userByEmail(email);
    const rows = await db.execute<{ count: number }>(
      sql`select count(*)::int as count from sessions where user_id = ${user.id}`,
    );
    expect(rows[0]?.count).toBe(0);
  });

  it("ne révèle pas si l'adresse existe", async () => {
    const res = await post("/request-password-reset", { email: newEmail(), redirectTo: "/r" });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(0);
  });
});

describe("audit des événements d'authentification", () => {
  async function authEvents() {
    return ops.execute<{
      action: string;
      actor_user_id: string | null;
      ip: string | null;
      after: unknown;
    }>(
      sql`select action, actor_user_id, host(ip) as ip, after from audit_log where tenant_id is null and action like 'auth.%' and ip = ${ip}::inet order by created_at`,
    );
  }

  it("l'application ne relit pas ces événements", async () => {
    const rows = await db.execute(sql`select 1 from audit_log where tenant_id is null`);
    expect(rows).toHaveLength(0);
  });

  it("trace la connexion réussie et l'échec, sans adresse e-mail", async () => {
    const email = newEmail();
    await post("/sign-up/email", { email, password, name: "A" });
    await post("/sign-in/email", { email, password: "mauvais-mot-de-passe" });
    await post("/sign-in/email", { email, password });
    const user = await userByEmail(email);
    const events = await authEvents();
    // L'inscription ouvre aussi une session : elle compte comme une connexion.
    expect(events.map((e) => e.action)).toEqual([
      "auth.sign_in",
      "auth.sign_in_failed",
      "auth.sign_in",
    ]);
    expect(events[1]).toMatchObject({ actor_user_id: null, after: { reason: "UNAUTHORIZED" } });
    expect(events[2]).toMatchObject({ actor_user_id: user.id, ip });
    expect(JSON.stringify(events)).not.toContain(email);
  });
});

describe("verrouillage progressif", () => {
  const signIn = (email: string, pw: string, fromIp: string) =>
    auth.handler(
      new Request(`${baseURL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: baseURL,
          "x-paiecam-client-ip": fromIp,
        },
        body: JSON.stringify({ email, password: pw }),
      }),
    );

  it("bloque l'adresse après 5 échecs, même répartis sur plusieurs IP et avec le bon mot de passe", async () => {
    const email = newEmail();
    await post("/sign-up/email", { email, password, name: "A" });
    for (let i = 0; i < 5; i++)
      expect((await signIn(email, "mauvais-mot-de-passe", `198.51.100.${i + 1}`)).status).toBe(401);
    const locked = await signIn(email, password, "198.51.100.99");
    expect(locked.status).toBe(429);
    expect(await locked.json()).toMatchObject({ code: "ACCOUNT_TEMPORARILY_LOCKED" });
  });

  it("une adresse inconnue se comporte exactement comme une adresse existante", async () => {
    const email = newEmail();
    for (let i = 0; i < 5; i++)
      expect((await signIn(email, "x-mot-de-passe-1", `198.51.101.${i + 1}`)).status).toBe(401);
    expect((await signIn(email, "x-mot-de-passe-1", "198.51.101.99")).status).toBe(429);
  });

  it("à l'expiration du blocage, une connexion réussie remet le compteur à zéro", async () => {
    const email = newEmail();
    await post("/sign-up/email", { email, password, name: "A" });
    for (let i = 0; i < 5; i++) await signIn(email, "mauvais-mot-de-passe", `198.51.102.${i + 1}`);
    await db.update(schema.loginLockouts).set({ lockedUntil: new Date(Date.now() - 1000) });
    expect((await signIn(email, password, "198.51.102.50")).status).toBe(200);
    expect((await signIn(email, "mauvais-mot-de-passe", "198.51.102.51")).status).toBe(401);
    expect((await signIn(email, password, "198.51.102.52")).status).toBe(200);
  });

  it("n'enregistre jamais l'adresse e-mail en clair", async () => {
    const rows = await db.select().from(schema.loginLockouts);
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toMatch(/@exemple\.test/);
  });
});
