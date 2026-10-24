/**
 * Charge un fichier de référentiel dans pay_rules, en brouillon (rôle propriétaire).
 * Usage : pnpm rules:load ../paie-engine/rules/cm-2026.draft.json
 * Une règle déjà validée n'est jamais écrasée ; un brouillon existant est mis à jour.
 */
import { checkRuleSet } from "@paiecam/paie-engine";
import { loadRuleFile } from "@paiecam/paie-engine/rules";
import { loadPayRules } from "../src/maintenance";

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

const { loaded, skipped } = await loadPayRules(url, rules);
console.warn(
  `${loaded} règle(s) chargée(s) en brouillon, ${skipped} règle(s) validée(s) laissée(s) intactes.`,
);
