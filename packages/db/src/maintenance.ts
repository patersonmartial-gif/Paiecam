/**
 * Opérations d'exploitation avec le rôle propriétaire (paiecam_owner) : migrations et chargement
 * du référentiel de paie. Utilisées par les scripts, l'installation locale et ses mises à jour.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/** Dossier des migrations livré avec le paquet (remplaçable : installation empaquetée). */
export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");

export async function runMigrations(ownerUrl: string, migrationsFolder = MIGRATIONS_DIR) {
  const client = postgres(ownerUrl, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end();
  }
}

export interface RuleToLoad {
  code: string;
  validFrom: string;
  validTo: string | null;
  value: unknown;
  legalSource: string;
  questions: string[];
}

/**
 * Charge des règles en brouillon. Une règle déjà validée n'est jamais écrasée ; un brouillon
 * existant est mis à jour. Tout ou rien (une transaction).
 */
export async function loadPayRules(
  ownerUrl: string,
  rules: readonly RuleToLoad[],
): Promise<{ loaded: number; skipped: number }> {
  const client = postgres(ownerUrl, { max: 1, onnotice: () => {} });
  let loaded = 0;
  let skipped = 0;
  try {
    await drizzle(client).transaction(async (tx) => {
      for (const r of rules) {
        const res = await tx.execute(sql`
          insert into pay_rules (id, code, valid_from, valid_to, value, legal_source, questions)
          values (gen_random_uuid(), ${r.code}, ${r.validFrom}, ${r.validTo}, ${JSON.stringify(r.value)}::jsonb,
                  ${r.legalSource}, ${JSON.stringify(r.questions)}::jsonb)
          on conflict (code, valid_from) do update
            set valid_to = excluded.valid_to, value = excluded.value,
                legal_source = excluded.legal_source, questions = excluded.questions
            where pay_rules.status = 'draft'
          returning id`);
        if (res.length > 0) loaded++;
        else skipped++;
      }
    });
  } finally {
    await client.end();
  }
  return { loaded, skipped };
}
