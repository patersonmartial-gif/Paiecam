import { applyRate, assertBasisPoints, assertFcfa, type BasisPoints, type Fcfa } from "./money";
import { resolveRule, type IsoDate, type PayRule } from "./rules";
import {
  RULE_CODES,
  type CnpsFamilyRule,
  type CnpsPensionRule,
  type CnpsWorkAccidentRule,
  type Regime,
} from "./types";

export interface CnpsInput {
  /** Salaire brut cotisable du mois. */
  brut: Fcfa;
  /** Date de référence de la période (ex. dernier jour du mois). */
  periodDate: IsoDate;
  regime: Regime;
  /** Taux AT/MP notifié à l'entreprise. */
  workAccidentRate: BasisPoints;
}

export interface CnpsResult {
  /** Assiette plafonnée de la pension vieillesse. */
  cappedBase: Fcfa;
  pensionEmployee: Fcfa;
  pensionEmployer: Fcfa;
  familyEmployer: Fcfa;
  workAccidentEmployer: Fcfa;
  totalEmployee: Fcfa;
  totalEmployer: Fcfa;
}

export function computeCnps(input: CnpsInput, rules: readonly PayRule[]): CnpsResult {
  const { brut, periodDate, regime, workAccidentRate } = input;
  assertFcfa(brut, "brut");
  if (brut < 0) throw new RangeError("le brut ne peut pas être négatif");
  assertBasisPoints(workAccidentRate, "taux AT/MP");

  const pension = resolveRule<CnpsPensionRule>(rules, RULE_CODES.cnpsPension, periodDate).value;
  const family = resolveRule<CnpsFamilyRule>(rules, RULE_CODES.cnpsFamily, periodDate).value;
  const accident = resolveRule<CnpsWorkAccidentRule>(
    rules,
    RULE_CODES.cnpsWorkAccident,
    periodDate,
  ).value;

  if (!accident.allowedEmployerRates.includes(workAccidentRate)) {
    throw new RangeError(`taux AT/MP non autorisé au ${periodDate} : ${workAccidentRate} bp`);
  }

  const pensionBase = Math.min(brut, pension.monthlyCeiling);
  const familyBase = Math.min(brut, family.monthlyCeiling);

  const pensionEmployee = applyRate(pensionBase, pension.employeeRate, pension.rounding);
  const pensionEmployer = applyRate(pensionBase, pension.employerRate, pension.rounding);
  const familyEmployer = applyRate(
    familyBase,
    family.employerRateByRegime[regime],
    family.rounding,
  );
  const workAccidentEmployer = applyRate(brut, workAccidentRate, accident.rounding);

  return {
    cappedBase: pensionBase,
    pensionEmployee,
    pensionEmployer,
    familyEmployer,
    workAccidentEmployer,
    totalEmployee: pensionEmployee,
    totalEmployer: pensionEmployer + familyEmployer + workAccidentEmployer,
  };
}
