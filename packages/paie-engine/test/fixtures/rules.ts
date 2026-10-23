import type { PayRule } from "../../src";

/**
 * Référentiel FICTIF pour les tests. Les dates de changement de plafond sont
 * inventées : elles servent à tester la gestion des dates d'effet, pas à
 * décrire la loi. Les vraies valeurs vivent dans pay_rules et sont validées
 * par l'expert-comptable.
 */
export const testRules: PayRule[] = [
  {
    code: "cnps.pension",
    validFrom: "2000-01-01",
    validTo: "2025-12-31",
    value: { employeeRate: 420, employerRate: 420, monthlyCeiling: 300_000, rounding: "nearest" },
  },
  {
    code: "cnps.pension",
    validFrom: "2026-01-01",
    validTo: null,
    value: { employeeRate: 420, employerRate: 420, monthlyCeiling: 750_000, rounding: "nearest" },
  },
  {
    code: "cnps.prestations_familiales",
    validFrom: "2000-01-01",
    validTo: "2025-12-31",
    value: {
      employerRateByRegime: { general: 700, agricole: 565, enseignement_prive: 370 },
      monthlyCeiling: 300_000,
      rounding: "nearest",
    },
  },
  {
    code: "cnps.prestations_familiales",
    validFrom: "2026-01-01",
    validTo: null,
    value: {
      employerRateByRegime: { general: 700, agricole: 565, enseignement_prive: 370 },
      monthlyCeiling: 750_000,
      rounding: "nearest",
    },
  },
  {
    code: "cnps.accidents_travail",
    validFrom: "2000-01-01",
    validTo: null,
    value: { allowedEmployerRates: [175, 250, 500], rounding: "nearest" },
  },
];
