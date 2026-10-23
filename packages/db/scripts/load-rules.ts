/**
 * Charge un fichier de référentiel dans pay_rules, en brouillon (rôle propriétaire).
 * Usage : pnpm rules:load ../paie-engine/rules/cm-2026.draft.json
 * Une règle déjà validée n'est jamais écrasée ; un brouillon existant est mis à jour.
 */
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { checkRuleSet } from "@paiecam/paie-engine";
import { loadRuleFile } from "@paiecam/paie-engine/rules";

try {
  process.loadEnvFile("../../.env");
} catch {
  // variables d'environnement déjà fournies
}

const file = process.argv[2];
const url = process.env.MIGRATION_DATABASE_URL;
if (!file || !url) {
  console.error("Usage : pnpm rules:load <fichier.json> (MIGRATION_DATABASE_URL requis)");
  process.exit(1);
}

const rules = loadRuleFile(file);
const issues = checkRuleSet(rules);
if (issues.length > 0) {
  console.error("Référentiel incohérent, rien n'est chargé :", issues);
  process.exit(1);
}

const client = postgres(url, { max: 1 });
const db = drizzle(client);
let loaded = 0;
let skipped = 0;
await db.transaction(async (tx) => {
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
await client.end();
console.warn(
  `${loaded} règle(s) chargée(s) en brouillon, ${skipped} règle(s) validée(s) laissée(s) intactes.`,
);
