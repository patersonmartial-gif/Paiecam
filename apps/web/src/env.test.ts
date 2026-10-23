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

const prodOk = {
  ...ok,
  NODE_ENV: "production",
  TRUSTED_PROXY_HEADER: "x-forwarded-for",
  SMTP_URL: "smtps://u:p@smtp.exemple.test:465",
  MAIL_FROM: "PaieCam <noreply@exemple.test>",
  STORAGE_DRIVER: "s3",
  S3_ENDPOINT: "https://s3.exemple.test",
  S3_REGION: "r",
  S3_BUCKET: "b",
  S3_ACCESS_KEY_ID: "k",
  S3_SECRET_ACCESS_KEY: "s",
  SECURITY_CONTACT: "mailto:securite@exemple.test",
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
    expect(() => parseEnv({ ...prodOk, TRUSTED_PROXY_HEADER: undefined })).toThrow(
      /TRUSTED_PROXY_HEADER/,
    );
    expect(parseEnv(ok).TRUSTED_PROXY_HOPS).toBe(1);
  });

  it("interdit de couper Have I Been Pwned en production", () => {
    const prod = prodOk;
    expect(parseEnv(prod).PWNED_PASSWORDS_CHECK).toBe("on");
    expect(() => parseEnv({ ...prod, PWNED_PASSWORDS_CHECK: "off" })).toThrow(/interdit/);
    expect(parseEnv({ ...ok, PWNED_PASSWORDS_CHECK: "off" }).PWNED_PASSWORDS_CHECK).toBe("off");
  });

  it("interdit la boîte d'envoi locale en production", () => {
    expect(() =>
      parseEnv({
        ...prodOk,
        MAIL_OUTBOX_DIR: "/tmp/x",
      }),
    ).toThrow(/interdit/);
  });

  it("brouillons de paie : autorisés hors production, interdits en production sauf pilote", () => {
    expect(parseEnv(ok).PAYROLL_ALLOW_DRAFT_RULES).toBe("on");
    expect(parseEnv(prodOk).PAYROLL_ALLOW_DRAFT_RULES).toBe("off");
    expect(
      parseEnv({
        ...prodOk,
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

  it("production : e-mail SMTP et stockage S3 obligatoires", () => {
    expect(parseEnv(prodOk).STORAGE_DRIVER).toBe("s3");
    expect(() => parseEnv({ ...prodOk, SMTP_URL: undefined })).toThrow(/SMTP_URL/);
    expect(() => parseEnv({ ...prodOk, STORAGE_DRIVER: "fs" })).toThrow(/STORAGE_DRIVER/);
    expect(() => parseEnv({ ...prodOk, S3_BUCKET: undefined })).toThrow(/S3_BUCKET/);
    expect(() => parseEnv({ ...ok, SMTP_URL: "http://pas-smtp" })).toThrow(/SMTP_URL/);
    expect(parseEnv(ok).STORAGE_DRIVER).toBe("fs");
    expect(() => parseEnv({ ...prodOk, SECURITY_CONTACT: undefined })).toThrow(/SECURITY_CONTACT/);
    expect(() => parseEnv({ ...ok, SECURITY_CONTACT: "javascript:alert(1)" })).toThrow(
      /SECURITY_CONTACT/,
    );
  });
});
