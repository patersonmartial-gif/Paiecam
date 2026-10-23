import { createHmac } from "node:crypto";

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of input.replace(/=+$/, "").toUpperCase()) {
    const v = alphabet.indexOf(c);
    if (v < 0) throw new Error("base32 invalide");
    bits += v.toString(2).padStart(5, "0");
  }
  const bytes = bits.match(/.{8}/g) ?? [];
  return Buffer.from(bytes.map((b) => parseInt(b, 2)));
}

/** Code TOTP (RFC 6238, SHA-1, 6 chiffres, 30 s) ; `offset` décale d'une ou plusieurs périodes. */
export function totp(secret: string, offset = 0): string {
  const counter = Math.floor(Date.now() / 30_000) + offset;
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const o = (hmac[hmac.length - 1] ?? 0) & 0xf;
  const code = (hmac.readUInt32BE(o) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, "0");
}
