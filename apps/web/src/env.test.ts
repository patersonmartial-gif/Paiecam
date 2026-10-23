import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const keys = `v1:${Buffer.alloc(32, 1).toString("base64")}`;
process.env.DATABASE_URL ??= "postgres://u:p@localhost:5432/db";
process.env.APP_URL ??= "http://localhost:3000";
process.env.BETTER_AUTH_SECRET ??= "x".repeat(32);
process.env.FIELD_ENCRYPTION_KEYS ??= keys;
const { parseEnv } = await import("./env-schema");

const ok = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  APP_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "x".repeat(32),
  FIELD_ENCRYPTION_KEYS: keys,
};

describe("parseEnv", () => {
  it("accepte une configuration valide", () => {
    expect(parseEnv(ok).NODE_ENV).toBe("development");
  });

  it("nomme les variables invalides sans révéler leur valeur", () => {
    expect(() => parseEnv({ ...ok, DATABASE_URL: "secret-value" })).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({ ...ok, DATABASE_URL: "secret-value" })).not.toThrow(/secret-value/);
  });

  it("exige l'en-tête IP de confiance en production", () => {
    expect(() =>
      parseEnv({ ...ok, NODE_ENV: "production", TRUSTED_PROXY_HEADER: undefined }),
    ).toThrow(/TRUSTED_PROXY_HEADER/);
    expect(parseEnv(ok).TRUSTED_PROXY_HOPS).toBe(1);
  });

  it("interdit de couper Have I Been Pwned en production", () => {
    const prod = { ...ok, NODE_ENV: "production", TRUSTED_PROXY_HEADER: "x-forwarded-for" };
    expect(parseEnv(prod).PWNED_PASSWORDS_CHECK).toBe("on");
    expect(() => parseEnv({ ...prod, PWNED_PASSWORDS_CHECK: "off" })).toThrow(/interdit/);
    expect(parseEnv({ ...ok, PWNED_PASSWORDS_CHECK: "off" }).PWNED_PASSWORDS_CHECK).toBe("off");
  });

  it("interdit la boîte d'envoi locale en production", () => {
    expect(() =>
      parseEnv({
        ...ok,
        NODE_ENV: "production",
        TRUSTED_PROXY_HEADER: "x-forwarded-for",
        MAIL_OUTBOX_DIR: "/tmp/x",
      }),
    ).toThrow(/interdit/);
  });

  it("brouillons de paie : autorisés hors production, interdits en production sauf pilote", () => {
    expect(parseEnv(ok).PAYROLL_ALLOW_DRAFT_RULES).toBe("on");
    expect(
      parseEnv({ ...ok, NODE_ENV: "production", TRUSTED_PROXY_HEADER: "x-forwarded-for" })
        .PAYROLL_ALLOW_DRAFT_RULES,
    ).toBe("off");
    expect(
      parseEnv({
        ...ok,
        NODE_ENV: "production",
        TRUSTED_PROXY_HEADER: "x-forwarded-for",
        PAYROLL_ALLOW_DRAFT_RULES: "on",
      }).PAYROLL_ALLOW_DRAFT_RULES,
    ).toBe("on");
  });

  it("exige un trousseau de chiffrement valide", () => {
    expect(() => parseEnv({ ...ok, FIELD_ENCRYPTION_KEYS: "" })).toThrow(/FIELD_ENCRYPTION_KEYS/);
    expect(() => parseEnv({ ...ok, FIELD_ENCRYPTION_KEYS: "v1:court" })).toThrow(
      /FIELD_ENCRYPTION_KEYS/,
    );
  });
});
