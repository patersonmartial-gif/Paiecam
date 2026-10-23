import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
process.env.DATABASE_URL ??= "postgres://u:p@localhost:5432/db";
process.env.APP_URL ??= "http://localhost:3000";
const { parseEnv } = await import("./env");

const ok = { DATABASE_URL: "postgres://u:p@localhost:5432/db", APP_URL: "http://localhost:3000" };

describe("parseEnv", () => {
  it("accepte une configuration valide", () => {
    expect(parseEnv(ok).NODE_ENV).toBe("development");
  });
  it("nomme les variables invalides sans révéler leur valeur", () => {
    expect(() => parseEnv({ ...ok, DATABASE_URL: "secret-value" })).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({ ...ok, DATABASE_URL: "secret-value" })).not.toThrow(/secret-value/);
  });
  it("exige la clé de chiffrement en production", () => {
    expect(() => parseEnv({ ...ok, NODE_ENV: "production" })).toThrow(/FIELD_ENCRYPTION_KEY/);
    const key = Buffer.alloc(32, 1).toString("base64");
    expect(parseEnv({ ...ok, NODE_ENV: "production", FIELD_ENCRYPTION_KEY: key }).NODE_ENV).toBe(
      "production",
    );
  });
});
