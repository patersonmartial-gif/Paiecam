import "server-only";
import { z } from "zod";

/** Seul point d'entrée des variables d'environnement côté serveur. */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url(),
  APP_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  /** Vérification Have I Been Pwned. « off » sert seulement hors ligne en développement. */
  PWNED_PASSWORDS_CHECK: z.enum(["on", "off"]).default("on"),
  FIELD_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "doit faire 32 octets en base64")
    .optional(),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  // Une variable vide (« FOO= » dans .env) est considérée comme absente.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ""));
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    // Uniquement les noms de variables, jamais leurs valeurs.
    const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Variables d'environnement invalides : ${names}`);
  }
  if (parsed.data.NODE_ENV === "production" && !parsed.data.FIELD_ENCRYPTION_KEY) {
    throw new Error("FIELD_ENCRYPTION_KEY est obligatoire en production");
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.PWNED_PASSWORDS_CHECK === "off") {
    throw new Error("PWNED_PASSWORDS_CHECK=off est interdit en production");
  }
  return parsed.data;
}

export const env = parseEnv(process.env);
