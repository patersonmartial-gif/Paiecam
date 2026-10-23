import { readFileSync } from "node:fs";
import type { PayRule } from "../src";

export interface RuleFileEntry extends PayRule {
  legalSource: string;
  questions: string[];
}

/** Lit un fichier de référentiel ; toutes ses règles sont des brouillons tant qu'elles ne sont pas validées en base. */
export function loadRuleFile(path: string): RuleFileEntry[] {
  const data = JSON.parse(readFileSync(path, "utf8")) as { rules: RuleFileEntry[] };
  return data.rules.map((r) => ({ ...r, status: "draft" }));
}
