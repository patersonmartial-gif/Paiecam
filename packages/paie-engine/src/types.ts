import type { BasisPoints, Fcfa, Rounding } from "./money";

/** Régime CNPS de l'employeur (détermine le taux des prestations familiales). */
export type Regime = "general" | "agricole" | "enseignement_prive";

/** Valeur de la règle `cnps.pension`. */
export interface CnpsPensionRule {
  employeeRate: BasisPoints;
  employerRate: BasisPoints;
  monthlyCeiling: Fcfa;
  rounding: Rounding;
}

/** Valeur de la règle `cnps.prestations_familiales`. */
export interface CnpsFamilyRule {
  employerRateByRegime: Record<Regime, BasisPoints>;
  monthlyCeiling: Fcfa;
  rounding: Rounding;
}

/** Valeur de la règle `cnps.accidents_travail`. */
export interface CnpsWorkAccidentRule {
  /** Taux autorisés ; le taux de l'entreprise est fixé par la CNPS selon son risque. */
  allowedEmployerRates: BasisPoints[];
  rounding: Rounding;
}

export const RULE_CODES = {
  cnpsPension: "cnps.pension",
  cnpsFamily: "cnps.prestations_familiales",
  cnpsWorkAccident: "cnps.accidents_travail",
} as const;
