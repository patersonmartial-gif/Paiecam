/** Contrôle d'un fichier de référentiel : pnpm rules:check [fichier.json] */
import { checkRuleSet } from "../src";
import { loadRuleFile } from "./load";

const file = process.argv[2] ?? new URL("./cm-2026.draft.json", import.meta.url).pathname;
const issues = checkRuleSet(loadRuleFile(file));
if (issues.length > 0) {
  console.error(issues);
  process.exit(1);
}
console.warn(`${file} : référentiel cohérent.`);
