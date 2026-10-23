import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptBlob, encryptBlob, parseKeyring, signMessage, verifySignature } from "../src";

const k1 = randomBytes(32).toString("base64");
const k2 = randomBytes(32).toString("base64");
const ring = parseKeyring(`v1:${k1}`);
const pdf = Buffer.from("%PDF-1.7 contenu fictif");

describe("encryptBlob / decryptBlob", () => {
  it("chiffre puis déchiffre, lié à l'emplacement", () => {
    const stored = encryptBlob(ring, "tenant/a/doc.pdf", pdf);
    expect(stored.includes(pdf)).toBe(false);
    expect(decryptBlob(ring, "tenant/a/doc.pdf", stored)).toEqual(pdf);
    expect(() => decryptBlob(ring, "tenant/b/doc.pdf", stored)).toThrow("déchiffrement impossible");
  });
  it("rejette un fichier altéré, tronqué ou chiffré avec une autre clé", () => {
    const stored = encryptBlob(ring, "k", pdf);
    const tampered = Buffer.from(stored);
    tampered[tampered.length - 20] = (tampered[tampered.length - 20] ?? 0) ^ 1;
    expect(() => decryptBlob(ring, "k", tampered)).toThrow("déchiffrement impossible");
    expect(() => decryptBlob(ring, "k", stored.subarray(0, 10))).toThrow(/mal formé/);
    expect(() => decryptBlob(ring, "k", Buffer.alloc(40))).toThrow(/mal formé/);
    expect(() => decryptBlob(ring, "k", Buffer.alloc(0))).toThrow(/mal formé/);
    expect(() => decryptBlob(parseKeyring(`v1:${k2}`), "k", stored)).toThrow(
      "déchiffrement impossible",
    );
  });
  it("reste lisible après rotation de clé", () => {
    const stored = encryptBlob(ring, "k", pdf);
    expect(decryptBlob(parseKeyring(`v2:${k2},v1:${k1}`), "k", stored)).toEqual(pdf);
  });
});

describe("signMessage / verifySignature", () => {
  it("vérifie une signature valide, refuse toute altération", () => {
    const sig = signMessage(ring, "sha|2026-03-31|CODE");
    expect(verifySignature(ring, "sha|2026-03-31|CODE", sig)).toBe(true);
    expect(verifySignature(ring, "sha|2026-03-31|AUTRE", sig)).toBe(false);
    expect(verifySignature(parseKeyring(`v1:${k2}`), "sha|2026-03-31|CODE", sig)).toBe(false);
    expect(verifySignature(ring, "x", "v9.abc")).toBe(false);
    expect(verifySignature(ring, "x", "mal-forme")).toBe(false);
    expect(verifySignature(ring, "x", "v1.AAAA")).toBe(false);
  });
  it("la clé de signature diffère des clés de chiffrement", () => {
    expect(ring.documentSigningKey("v1").equals(ring.encryptionKey("v1"))).toBe(false);
  });
});
