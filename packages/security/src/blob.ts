import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { Keyring } from "./keyring";

/**
 * Chiffrement d'un fichier (PDF…) : AES-256-GCM, lié à son emplacement de stockage (données associées).
 * Format : [longueur du kid (1 octet)][kid][IV 12 octets][chiffré][tag 16 octets].
 */
export function encryptBlob(keyring: Keyring, storageKey: string, data: Uint8Array): Buffer {
  const kid = Buffer.from(keyring.currentId, "utf8");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyring.encryptionKey(keyring.currentId), iv);
  cipher.setAAD(Buffer.from(`blob|${storageKey}`));
  const body = Buffer.concat([cipher.update(data), cipher.final(), cipher.getAuthTag()]);
  return Buffer.concat([Buffer.from([kid.length]), kid, iv, body]);
}

/** Identifiant de la clé qui a chiffré un fichier (sans le déchiffrer). */
export function blobKeyId(stored: Uint8Array): string {
  const kidLength = stored[0] ?? 0;
  const kid = Buffer.from(stored.subarray(1, 1 + kidLength)).toString("utf8");
  if (kidLength === 0 || !/^v\d+$/.test(kid)) throw new Error("fichier chiffré mal formé");
  return kid;
}

export function decryptBlob(keyring: Keyring, storageKey: string, stored: Uint8Array): Buffer {
  const buf = Buffer.from(stored);
  const kidLength = buf[0] ?? 0;
  if (kidLength === 0 || buf.length < 1 + kidLength + 12 + 16)
    throw new Error("fichier chiffré mal formé");
  const kid = buf.subarray(1, 1 + kidLength).toString("utf8");
  const iv = buf.subarray(1 + kidLength, 13 + kidLength);
  const body = buf.subarray(13 + kidLength);
  const decipher = createDecipheriv("aes-256-gcm", keyring.encryptionKey(kid), iv);
  decipher.setAAD(Buffer.from(`blob|${storageKey}`));
  decipher.setAuthTag(body.subarray(body.length - 16));
  try {
    return Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]);
  } catch {
    throw new Error("déchiffrement impossible");
  }
}

/** Signature serveur (HMAC) d'un message ; format « <kid>.<base64url> ». */
export function signMessage(keyring: Keyring, message: string): string {
  const kid = keyring.currentId;
  const mac = createHmac("sha256", keyring.documentSigningKey(kid))
    .update(message)
    .digest("base64url");
  return `${kid}.${mac}`;
}

export function verifySignature(keyring: Keyring, message: string, signature: string): boolean {
  const [kid, mac, ...rest] = signature.split(".");
  if (!kid || !mac || rest.length > 0) return false;
  let expected: Buffer;
  try {
    expected = createHmac("sha256", keyring.documentSigningKey(kid)).update(message).digest();
  } catch {
    return false;
  }
  const given = Buffer.from(mac, "base64url");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
