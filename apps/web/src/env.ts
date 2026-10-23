import "server-only";
import { z } from "zod";
import { parseKeyring } from "@paiecam/security";

/** Seul point d'entrée des variables d'environnement côté serveur. */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url(),
  APP_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  /** Vérification Have I Been Pwned. « off » sert seulement hors ligne en développement. */
  PWNED_PASSWORDS_CHECK: z.enum(["on", "off"]).default("on"),
  /** Dossier où écrire les e-mails en développement (interdit en production). */
  MAIL_OUTBOX_DIR: z.string().optional(),
  /** Trousseau « v2:<base64>,v1:<base64> » ; la première clé chiffre. */
  FIELD_ENCRYPTION_KEYS: z
    .string()
    .refine((v) => {
      try {
        parseKeyring(v);
        return true;
      } catch {
        return false;
      }
    }, "trousseau invalide")
    .optional(),
});

export type Env = z.infer<typeof schema> & { FIELD_ENCRYPTION_KEYS: string };

export function parseEnv(source: Record<string, string | undefined>): Env {
  // Une variable vide (« FOO= » dans .env) est considérée comme absente.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ""));
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    // Uniquement les noms de variables, jamais leurs valeurs.
    const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Variables d'environnement invalides : ${names}`);
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.MAIL_OUTBOX_DIR) {
    throw new Error("MAIL_OUTBOX_DIR est interdit en production");
  }
  if (!parsed.data.FIELD_ENCRYPTION_KEYS) {
    throw new Error("FIELD_ENCRYPTION_KEYS est obligatoire (voir .env.example)");
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.PWNED_PASSWORDS_CHECK === "off") {
    throw new Error("PWNED_PASSWORDS_CHECK=off est interdit en production");
  }
  return parsed.data as Env;
}

export const env = parseEnv(process.env);
