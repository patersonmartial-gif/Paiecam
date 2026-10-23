import { createHash, randomInt } from "node:crypto";

/** Code de vérification : 16 caractères sans ambiguïté (pas de 0/O, 1/I), groupés par 4. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function newVerificationCode(): string {
  const chars = Array.from({ length: 16 }, () => ALPHABET[randomInt(ALPHABET.length)]);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join("")).join("-");
}

export const sha256Hex = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

/** Message signé pour un document : empreinte du fichier, date d'émission, code. */
export const signedMessage = (sha256: string, issuedAt: string, code: string) =>
  `${sha256}|${issuedAt}|${code}`;
