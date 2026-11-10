/** Contrôle d'un fichier de référentiel : pnpm rules:check [fichier.json] */
import { checkRuleSet } from "../src";
import { loadRuleFile } from "./load";
import { fileURLToPath } from "node:url";

const file = process.argv[2] ?? fileURLToPath(new URL("./cm-2026.draft.json", import.meta.url));
const issues = checkRuleSet(loadRuleFile(file));
if (issues.length > 0) {
  console.error(issues);
  process.exit(1);
}
console.warn(`${file} : référentiel cohérent.`);
