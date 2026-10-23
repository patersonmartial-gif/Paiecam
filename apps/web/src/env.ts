import "server-only";
import { z } from "zod";

/** Seul point d'entrée des variables d'environnement côté serveur. */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url(),
  APP_URL: z.url(),
  FIELD_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "doit faire 32 octets en base64")
    .optional(),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    // Uniquement les noms de variables, jamais leurs valeurs.
    const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Variables d'environnement invalides : ${names}`);
  }
  if (parsed.data.NODE_ENV === "production" && !parsed.data.FIELD_ENCRYPTION_KEY) {
    throw new Error("FIELD_ENCRYPTION_KEY est obligatoire en production");
  }
  return parsed.data;
}

export const env = parseEnv(process.env);
