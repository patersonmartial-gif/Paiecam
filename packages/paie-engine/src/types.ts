import { z } from "zod";

/** Régime CNPS de l'employeur (détermine le taux des prestations familiales). */
export type Regime = "general" | "agricole" | "enseignement_prive";

const fcfa = z.number().int().nonnegative();
const bp = z.number().int().min(0).max(10_000);
const rounding = z.enum(["nearest", "down", "up"]);

/**
 * Tranches contiguës et croissantes : la première commence à 0, chaque `from` suit le `to`
 * précédent (+1 franc), seule la dernière est ouverte (`to: null`).
 */
function checkBrackets(list: { from: number; to: number | null }[], ctx: z.RefinementCtx): void {
  list.forEach((b, i) => {
    const issue = (message: string, key: "from" | "to") =>
      ctx.addIssue({ code: "custom", message, path: [i, key] });
    if (i === 0 && b.from !== 0) issue("la première tranche commence à 0", "from");
    const prev = list[i - 1];
    if (prev && (prev.to === null || b.from !== prev.to + 1))
      issue("tranches non contiguës", "from");
    if (b.to !== null && b.to < b.from) issue("tranche inversée", "to");
    if (b.to === null && i !== list.length - 1)
      issue("seule la dernière tranche est ouverte", "to");
  });
  if (list.at(-1)?.to !== null)
    ctx.addIssue({ code: "custom", message: "la dernière tranche doit être ouverte" });
}

const rateBrackets = z
  .array(z.object({ from: fcfa, to: fcfa.nullable(), rate: bp }))
  .min(1)
  .superRefine(checkBrackets);
const amountBrackets = z
  .array(z.object({ from: fcfa, to: fcfa.nullable(), amount: fcfa }))
  .min(1)
  .superRefine(checkBrackets);

export const ruleSchemas = {
  "cnps.pension": z.object({
    employeeRate: bp,
    employerRate: bp,
    monthlyCeiling: fcfa,
    rounding,
  }),
  "cnps.prestations_familiales": z.object({
    employerRateByRegime: z.object({ general: bp, agricole: bp, enseignement_prive: bp }),
    monthlyCeiling: fcfa,
    rounding,
  }),
  "cnps.accidents_travail": z.object({
    /** Taux autorisés ; le taux de l'entreprise est notifié par la CNPS selon son risque. */
    allowedEmployerRates: z.array(bp).min(1),
    rounding,
  }),
  "irpp.bareme": z.object({
    /** Barème ANNUEL, appliqué au revenu net imposable annualisé. */
    brackets: rateBrackets,
    /** Abattement pour frais professionnels, sur le brut imposable. */
    professionalExpensesRate: bp,
    /** Plafond MENSUEL de cet abattement ; null = sans plafond. */
    professionalExpensesMonthlyCap: fcfa.nullable(),
    /** Abattement annuel forfaitaire. */
    annualAllowance: fcfa,
    /** En dessous de ce brut imposable mensuel, pas d'IRPP. */
    monthlyExemptionThreshold: fcfa,
    rounding,
  }),
  cac: z.object({
    /** Centimes additionnels communaux : pourcentage de l'IRPP (et non du salaire). */
    rateOfIrpp: bp,
    rounding,
  }),
  cfc: z.object({ employeeRate: bp, employerRate: bp, rounding }),
  fne: z.object({ employerRate: bp, rounding }),
  rav: z.object({
    /** Montant mensuel forfaitaire selon le brut imposable mensuel. */
    brackets: amountBrackets,
  }),
  tdl: z.object({
    /** Montant mensuel selon le salaire de base mensuel. */
    brackets: amountBrackets,
  }),
  "heures_sup.majorations": z.object({
    /** Diviseur horaire mensuel en centièmes d'heure (173,33 h → 17333). */
    monthlyHoursHundredths: z.number().int().positive(),
    /** Majoration par catégorie d'heures, en points de base (20 % → 2000). */
    rates: z.record(z.string().regex(/^[a-z0-9_]+$/), bp),
    rounding,
  }),
  echeances: z.object({
    /** Jour du mois suivant la paie où chaque déclaration (et son paiement) est due. */
    dayOfFollowingMonth: z.object({
      cnps: z.number().int().min(1).max(28),
      dgi: z.number().int().min(1).max(28),
    }),
  }),
} as const;

export type RuleCode = keyof typeof ruleSchemas;
export type RuleValue<C extends RuleCode> = z.infer<(typeof ruleSchemas)[C]>;

export type CnpsPensionRule = RuleValue<"cnps.pension">;
export type CnpsFamilyRule = RuleValue<"cnps.prestations_familiales">;
export type CnpsWorkAccidentRule = RuleValue<"cnps.accidents_travail">;
export type IrppRule = RuleValue<"irpp.bareme">;
export type CacRule = RuleValue<"cac">;
export type CfcRule = RuleValue<"cfc">;
export type FneRule = RuleValue<"fne">;
export type BracketAmountRule = RuleValue<"rav">;
export type OvertimeRule = RuleValue<"heures_sup.majorations">;

export const RULE_CODES = {
  cnpsPension: "cnps.pension",
  cnpsFamily: "cnps.prestations_familiales",
  cnpsWorkAccident: "cnps.accidents_travail",
  irpp: "irpp.bareme",
  cac: "cac",
  cfc: "cfc",
  fne: "fne",
  rav: "rav",
  tdl: "tdl",
  overtime: "heures_sup.majorations",
  deadlines: "echeances",
} as const satisfies Record<string, RuleCode>;
