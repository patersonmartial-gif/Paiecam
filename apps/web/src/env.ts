import "server-only";
import { parseEnv } from "./env-schema";

export type { Env } from "./env-schema";
export { parseEnv };

/** Seul point d'entrée des variables d'environnement côté serveur Next.js. */
export const env = parseEnv(process.env);
