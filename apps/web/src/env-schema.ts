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
  /**
   * Calcul avec des règles de paie en brouillon (bulletins « PROVISOIRE », validation impossible).
   * Par défaut : autorisé hors production, interdit en production sauf pilote déclaré.
   */
  PAYROLL_ALLOW_DRAFT_RULES: z.enum(["on", "off"]).optional(),
  /**
   * En-tête posé par le proxy de l'hébergeur avec l'IP du client (ex. x-forwarded-for).
   * Obligatoire en production : sans lui, tous les clients partagent la même limite de tentatives.
   */
  TRUSTED_PROXY_HEADER: z
    .string()
    .regex(/^[a-z0-9-]+$/i)
    .optional(),
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(1).max(5).default(1),
  /** Dossier du stockage chiffré des documents (développement : disque ; production : S3, phase 6). */
  DOCUMENTS_DIR: z.string().min(1).default("../../.data/documents"),
  /** Envoi des e-mails (production) : URL SMTP du fournisseur et adresse d'expédition. */
  SMTP_URL: z
    .string()
    .regex(/^smtps?:\/\//)
    .optional(),
  MAIL_FROM: z.string().min(3).optional(),
  /** Stockage des documents : disque (développement) ou S3 (production). */
  STORAGE_DRIVER: z.enum(["fs", "s3"]).default("fs"),
  S3_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  /** Contact de signalement des vulnérabilités publié dans /.well-known/security.txt (RFC 9116). */
  SECURITY_CONTACT: z
    .string()
    .regex(/^(mailto:|https:\/\/)\S+$/)
    .optional(),
  /** Rôle paiecam_rotation, utilisé seulement par la commande de rotation des clés. */
  ROTATION_DATABASE_URL: z.url().optional(),
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

export type Env = z.infer<typeof schema> & {
  FIELD_ENCRYPTION_KEYS: string;
  PAYROLL_ALLOW_DRAFT_RULES: "on" | "off";
};

export function parseEnv(source: Record<string, string | undefined>): Env {
  // Une variable vide (« FOO= » dans .env) est considérée comme absente.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ""));
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    // Uniquement les noms de variables, jamais leurs valeurs.
    const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Variables d'environnement invalides : ${names}`);
  }
  if (parsed.data.NODE_ENV === "production" && !parsed.data.TRUSTED_PROXY_HEADER) {
    throw new Error("TRUSTED_PROXY_HEADER est obligatoire en production");
  }
  if (parsed.data.NODE_ENV === "production" && (!parsed.data.SMTP_URL || !parsed.data.MAIL_FROM)) {
    throw new Error("SMTP_URL et MAIL_FROM sont obligatoires en production");
  }
  if (parsed.data.NODE_ENV === "production" && !parsed.data.SECURITY_CONTACT) {
    throw new Error("SECURITY_CONTACT est obligatoire en production (mailto:… ou https://…)");
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.STORAGE_DRIVER !== "s3") {
    throw new Error("STORAGE_DRIVER=s3 est obligatoire en production");
  }
  if (
    parsed.data.STORAGE_DRIVER === "s3" &&
    !(
      parsed.data.S3_ENDPOINT &&
      parsed.data.S3_REGION &&
      parsed.data.S3_BUCKET &&
      parsed.data.S3_ACCESS_KEY_ID &&
      parsed.data.S3_SECRET_ACCESS_KEY
    )
  ) {
    throw new Error(
      "Stockage S3 : S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID et S3_SECRET_ACCESS_KEY sont requis",
    );
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
  const allowDraft =
    parsed.data.PAYROLL_ALLOW_DRAFT_RULES ?? (parsed.data.NODE_ENV === "production" ? "off" : "on");
  return { ...parsed.data, PAYROLL_ALLOW_DRAFT_RULES: allowDraft } as Env;
}
