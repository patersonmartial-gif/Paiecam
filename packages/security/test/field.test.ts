import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  blindIndex,
  decryptField,
  encryptField,
  maskTail,
  needsReencryption,
  parseKeyring,
  type FieldContext,
} from "../src";

const k = () => randomBytes(32).toString("base64");
const k1 = k();
const k2 = k();
const ring = parseKeyring(`v1:${k1}`);
const ctx: FieldContext = {
  tenantId: "01a1-tenant-a",
  table: "employee_bank_details",
  column: "iban",
  rowId: "01a1-row-1",
};
const iban = "CM2110001000010123456789012";

describe("parseKeyring", () => {
  it("lit plusieurs clés, la première chiffre", () => {
    expect(parseKeyring(`v2:${k2}, v1:${k1}`).currentId).toBe("v2");
  });
  it("refuse un trousseau mal formé", () => {
    expect(() => parseKeyring("")).toThrow(/vide/);
    expect(() => parseKeyring("cle")).toThrow(/format/);
    expect(() => parseKeyring(`x1:${k1}`)).toThrow(/format/);
    expect(() => parseKeyring(`v1:${k1}:extra`)).toThrow(/format/);
    expect(() => parseKeyring("v1:dHJvcC1jb3VydGU=")).toThrow(/32 octets/);
    expect(() => parseKeyring(`v1:${k1},v1:${k2}`)).toThrow(/double/);
  });
  it("refuse une clé inconnue", () => {
    expect(() => ring.encryptionKey("v9")).toThrow(/absente/);
  });
  it("dérive des sous-clés différentes par usage", () => {
    expect(ring.encryptionKey("v1").equals(ring.blindIndexKey("v1"))).toBe(false);
    expect(ring.encryptionKey("v1")).toBe(ring.encryptionKey("v1"));
  });
});

describe("encryptField / decryptField", () => {
  it("chiffre puis déchiffre", () => {
    const stored = encryptField(ring, ctx, iban);
    expect(stored).toMatch(/^v1\.[\w-]{16}\.[\w-]+$/);
    expect(stored).not.toContain("0123456789");
    expect(decryptField(ring, ctx, stored)).toBe(iban);
  });

  it("produit un chiffré différent à chaque fois (IV aléatoire)", () => {
    expect(encryptField(ring, ctx, iban)).not.toBe(encryptField(ring, ctx, iban));
  });

  it("aller-retour pour toute chaîne", () => {
    fc.assert(
      fc.property(fc.string(), (s) => decryptField(ring, ctx, encryptField(ring, ctx, s)) === s),
    );
  });

  it("rejette une valeur copiée vers une autre entreprise, colonne ou ligne", () => {
    const stored = encryptField(ring, ctx, iban);
    for (const other of [
      { ...ctx, tenantId: "01a1-tenant-b" },
      { ...ctx, column: "mobile_money_number" },
      { ...ctx, rowId: "01a1-row-2" },
      { ...ctx, table: "employees" },
    ]) {
      expect(() => decryptField(ring, other, stored)).toThrow("déchiffrement impossible");
    }
  });

  it("rejette une valeur altérée", () => {
    const stored = encryptField(ring, ctx, iban);
    const [kid, iv, body] = stored.split(".") as [string, string, string];
    const flipped = Buffer.from(body, "base64url");
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    expect(() => decryptField(ring, ctx, `${kid}.${iv}.${flipped.toString("base64url")}`)).toThrow(
      "déchiffrement impossible",
    );
  });

  it("rejette une valeur mal formée", () => {
    for (const bad of ["", "v1", "v1.a", "v1.a.b.c", "v1.AAAA.AAAA", `v1.${"A".repeat(16)}.AAAA`]) {
      expect(() => decryptField(ring, ctx, bad)).toThrow(/mal formée/);
    }
  });

  it("refuse un contexte vide ou ambigu", () => {
    expect(() => encryptField(ring, { ...ctx, rowId: "" }, iban)).toThrow(/contexte/);
    expect(() => encryptField(ring, { ...ctx, table: "a|b" }, iban)).toThrow(/contexte/);
  });

  it("rotation : l'ancienne clé déchiffre encore, la nouvelle chiffre", () => {
    const old = encryptField(ring, ctx, iban);
    const rotated = parseKeyring(`v2:${k2},v1:${k1}`);
    expect(decryptField(rotated, ctx, old)).toBe(iban);
    expect(needsReencryption(rotated, old)).toBe(true);
    const fresh = encryptField(rotated, ctx, iban);
    expect(fresh.startsWith("v2.")).toBe(true);
    expect(needsReencryption(rotated, fresh)).toBe(false);
    // Sans l'ancienne clé, plus rien ne se déchiffre.
    expect(() => decryptField(parseKeyring(`v2:${k2}`), ctx, old)).toThrow(/absente/);
  });

  it("une autre clé maîtresse ne déchiffre pas", () => {
    const stored = encryptField(ring, ctx, iban);
    expect(() => decryptField(parseKeyring(`v1:${k2}`), ctx, stored)).toThrow(
      "déchiffrement impossible",
    );
  });
});

describe("blindIndex", () => {
  it("est stable malgré espaces, tirets et casse", () => {
    expect(blindIndex(ring, "t", "cnps", "123-456 789 a")).toBe(
      blindIndex(ring, "t", "cnps", "123456789A"),
    );
  });
  it("diffère selon l'entreprise et l'usage", () => {
    const a = blindIndex(ring, "tenant-a", "cnps", "123456789");
    expect(a).not.toBe(blindIndex(ring, "tenant-b", "cnps", "123456789"));
    expect(a).not.toBe(blindIndex(ring, "tenant-a", "niu", "123456789"));
    expect(a).not.toContain("123456789");
  });
});

describe("maskTail", () => {
  it("ne laisse voir que la fin", () => {
    expect(maskTail(iban)).toBe("•••• 9012");
    expect(maskTail("+237 690 00 12 34", 4)).toBe("•••• 1234");
    expect(maskTail("123")).toBe("••••");
  });
});
