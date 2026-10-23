import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
process.env.DATABASE_URL ??= "postgres://u:p@localhost:5432/db";
process.env.APP_URL ??= "http://localhost:3000";
process.env.BETTER_AUTH_SECRET ??= "x".repeat(32);
const { parseEnv } = await import("./env");

const ok = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  APP_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "x".repeat(32),
};

describe("parseEnv", () => {
  it("accepte une configuration valide", () => {
    expect(parseEnv(ok).NODE_ENV).toBe("development");
  });
  it("nomme les variables invalides sans révéler leur valeur", () => {
    expect(() => parseEnv({ ...ok, DATABASE_URL: "secret-value" })).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({ ...ok, DATABASE_URL: "secret-value" })).not.toThrow(/secret-value/);
  });
  it("interdit de couper Have I Been Pwned en production", () => {
    const key = Buffer.alloc(32, 1).toString("base64");
    const prod = { ...ok, NODE_ENV: "production", FIELD_ENCRYPTION_KEY: key };
    expect(parseEnv(prod).PWNED_PASSWORDS_CHECK).toBe("on");
    expect(() => parseEnv({ ...prod, PWNED_PASSWORDS_CHECK: "off" })).toThrow(/interdit/);
    expect(parseEnv({ ...ok, PWNED_PASSWORDS_CHECK: "off" }).PWNED_PASSWORDS_CHECK).toBe("off");
  });

  it("exige la clé de chiffrement en production", () => {
    expect(() => parseEnv({ ...ok, NODE_ENV: "production" })).toThrow(/FIELD_ENCRYPTION_KEY/);
    const key = Buffer.alloc(32, 1).toString("base64");
    expect(parseEnv({ ...ok, NODE_ENV: "production", FIELD_ENCRYPTION_KEY: key }).NODE_ENV).toBe(
      "production",
    );
  });
});
