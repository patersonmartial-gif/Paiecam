import { readdirSync, readFileSync } from "node:fs";
import { z } from "zod";
import type { PayRule, PayslipInput } from "../../src";
import { loadRuleFile } from "../../rules/load";

/**
 * Format d'un cas de test de bulletin (golden ou référence). Uniquement des données anonymisées :
 * aucun nom, n° CNPS, NIU ni IBAN réel. Les montants attendus sont ceux du bulletin réel.
 */
export const caseSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  description: z.string(),
  /** Golden : nom de l'expert-comptable et date de validation écrite. Référence : URL et date de consultation. */
  provenance: z.object({
    by: z.string().min(2),
    date: z.iso.date(),
    url: z.url().optional(),
    note: z.string().optional(),
  }),
  /** Fichier de référentiel à appliquer, relatif au dossier rules/. */
  rulesFile: z.string(),
  input: z.custom<PayslipInput>((v) => typeof v === "object" && v !== null),
  expected: z.object({
    /** Montant attendu par code de ligne (seules les lignes listées sont comparées). */
    lines: z.record(z.string(), z.number().int()).default({}),
    netPay: z.number().int(),
    employerCost: z.number().int().optional(),
  }),
});
export type PayslipCase = z.infer<typeof caseSchema>;

export function loadCases(dir: URL): { file: string; data: PayslipCase; rules: PayRule[] }[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  return files.map((file) => {
    const data = caseSchema.parse(JSON.parse(readFileSync(new URL(file, dir), "utf8")));
    const rules = loadRuleFile(new URL(`../../rules/${data.rulesFile}`, import.meta.url).pathname);
    return { file, data, rules };
  });
}
