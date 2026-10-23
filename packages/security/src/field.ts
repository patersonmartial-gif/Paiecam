import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import type { Keyring } from "./keyring";

/**
 * Contexte lié à chaque valeur chiffrée (données associées AES-GCM) : une valeur copiée
 * vers une autre entreprise, table, colonne ou ligne ne se déchiffre plus.
 */
export interface FieldContext {
  tenantId: string;
  table: string;
  column: string;
  rowId: string;
}

function aad(ctx: FieldContext): Buffer {
  for (const part of [ctx.tenantId, ctx.table, ctx.column, ctx.rowId]) {
    if (!part || part.includes("|")) throw new Error("contexte de chiffrement invalide");
  }
  return Buffer.from(`${ctx.tenantId}|${ctx.table}|${ctx.column}|${ctx.rowId}`);
}

/** Format stocké : « <kid>.<iv base64url>.<chiffré+tag base64url> ». */
export function encryptField(keyring: Keyring, ctx: FieldContext, plaintext: string): string {
  const kid = keyring.currentId;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyring.encryptionKey(kid), iv);
  cipher.setAAD(aad(ctx));
  const body = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return `${kid}.${iv.toString("base64url")}.${body.toString("base64url")}`;
}

export function decryptField(keyring: Keyring, ctx: FieldContext, stored: string): string {
  const [kid, ivB64, bodyB64, ...rest] = stored.split(".");
  if (!kid || !ivB64 || !bodyB64 || rest.length > 0) throw new Error("valeur chiffrée mal formée");
  const iv = Buffer.from(ivB64, "base64url");
  const body = Buffer.from(bodyB64, "base64url");
  if (iv.length !== 12 || body.length < 16) throw new Error("valeur chiffrée mal formée");
  const decipher = createDecipheriv("aes-256-gcm", keyring.encryptionKey(kid), iv);
  decipher.setAAD(aad(ctx));
  decipher.setAuthTag(body.subarray(body.length - 16));
  try {
    return Buffer.concat([
      decipher.update(body.subarray(0, body.length - 16)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Ne jamais renvoyer le détail : valeur altérée, mauvais contexte ou mauvaise clé.
    throw new Error("déchiffrement impossible");
  }
}

/** Identifiant de la clé d'une valeur stockée « <kid>.… » (champ chiffré, empreinte ou signature). */
export function storedKeyId(stored: string): string {
  const kid = /^(v\d+)\./.exec(stored)?.[1];
  if (!kid) throw new Error("valeur stockée sans identifiant de clé");
  return kid;
}

/** Indique si la valeur a été chiffrée avec une ancienne clé et doit être rechiffrée. */
export function needsReencryption(keyring: Keyring, stored: string): boolean {
  return !stored.startsWith(`${keyring.currentId}.`);
}

/**
 * Empreinte déterministe (HMAC) pour détecter les doublons sans déchiffrer.
 * Elle inclut l'entreprise : un même n° CNPS donne des empreintes différentes d'une entreprise à l'autre.
 * Après une rotation de clé, les empreintes existantes doivent être recalculées (préfixe = kid).
 */
export function blindIndex(
  keyring: Keyring,
  tenantId: string,
  purpose: string,
  value: string,
): string {
  const normalized = value
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[\s.-]/g, "");
  const kid = keyring.currentId;
  const mac = createHmac("sha256", keyring.blindIndexKey(kid))
    .update(`${tenantId}|${purpose}|${normalized}`)
    .digest("base64url");
  return `${kid}.${mac}`;
}

/** Affichage masqué : seuls les 4 derniers caractères significatifs restent visibles. */
export function maskTail(value: string, visible = 4): string {
  const compact = value.replace(/\s/g, "");
  if (compact.length <= visible) return "••••";
  return `•••• ${compact.slice(-visible)}`;
}
