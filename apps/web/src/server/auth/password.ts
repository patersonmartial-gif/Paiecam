import { hash, verify } from "@node-rs/argon2";

/** Argon2id avec les paramètres minimaux recommandés par l'OWASP (19 Mio, 2 itérations). */
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword({
  hash: stored,
  password,
}: {
  hash: string;
  password: string;
}): Promise<boolean> {
  if (!stored.startsWith("$argon2id$")) return false;
  return verify(stored, password);
}
