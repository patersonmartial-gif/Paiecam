import { bracketAmount, mulDiv, progressiveTax } from "./brackets";
import { computeCnps } from "./cnps";
import { applyRate, assertBasisPoints, assertFcfa, type BasisPoints, type Fcfa } from "./money";
import { assertValidated, resolveRule, type IsoDate, type PayRule } from "./rules";
import { RULE_CODES, type Regime, type RuleCode } from "./types";

/**
 * Rubrique variable du mois.
 * - earning : prime, indemnité ou gratification versée (soumise ou non à CNPS / IRPP selon ses drapeaux) ;
 * - in_kind : avantage en nature (entre dans le brut mais n'est pas versé) ;
 * - non_taxable_allowance : indemnité hors brut (ex. remboursement de frais), versée telle quelle ;
 * - deduction : avance ou remboursement de prêt, retenu sur le net.
 */
export interface PayItemInput {
  code: string;
  label: string;
  kind: "earning" | "in_kind" | "non_taxable_allowance" | "deduction";
  amount: Fcfa;
  subjectToCnps: boolean;
  taxable: boolean;
}

export interface OvertimeInput {
  /** Catégorie déclarée dans la règle heures_sup.majorations (ex. hs_20). */
  category: string;
  /** Heures en centièmes (8 h 30 → 850). */
  hoursHundredths: number;
}

export interface PayslipInput {
  /** Premier et dernier jour du mois de paie. */
  period: { start: IsoDate; end: IsoDate };
  employer: { regime: Regime; workAccidentRate: BasisPoints };
  employee: { baseSalary: Fcfa; hireDate: IsoDate; endDate: IsoDate | null };
  items?: PayItemInput[];
  overtime?: OvertimeInput[];
  /** Jours d'absence non payés dans le mois (déduits des jours de présence). */
  unpaidAbsenceDays?: number;
}

export type PayslipSection =
  "earning" | "employee_contribution" | "employer_contribution" | "allowance" | "deduction";

export interface PayslipLine {
  code: string;
  label: string;
  section: PayslipSection;
  amount: Fcfa;
  base?: Fcfa;
  rate?: BasisPoints;
  ruleCode?: RuleCode;
  /** Détail lisible du calcul, pour le salarié et l'expert-comptable. */
  explanation: string;
}

export interface RuleRef {
  id?: string;
  code: string;
  validFrom: IsoDate;
  status: "draft" | "validated";
}

export interface PayslipTotals {
  /** Brut (salaire de base proratisé + heures sup + primes + avantages en nature). */
  gross: Fcfa;
  cnpsBase: Fcfa;
  taxableGross: Fcfa;
  inKind: Fcfa;
  nonTaxableAllowances: Fcfa;
  employeeContributions: Fcfa;
  employerContributions: Fcfa;
  deductions: Fcfa;
  /** Revenu net imposable mensuel (après frais professionnels et CNPS salariale). */
  netTaxableMonthly: Fcfa;
  /** Base annuelle du barème IRPP (après abattement annuel). */
  irppAnnualBase: Fcfa;
  netPay: Fcfa;
  employerCost: Fcfa;
}

export interface Payslip {
  period: { start: IsoDate; end: IsoDate };
  presence: { days: number; daysInPeriod: number; absence: number };
  lines: PayslipLine[];
  totals: PayslipTotals;
  /** Instantané des règles utilisées : conservé avec la paie validée. */
  rulesUsed: RuleRef[];
  warnings: ("net_negative" | "irpp_below_threshold" | "partial_month")[];
}

const fr = new Intl.NumberFormat("fr-FR");
const money = (n: number) => `${fr.format(n)} FCFA`;
const pct = (rate: BasisPoints) => `${fr.format(rate / 100)} %`;

function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;
}

/** Jours de présence dans la période (entrée ou sortie en cours de mois), en jours calendaires. */
function presenceDays(input: PayslipInput): {
  days: number;
  daysInPeriod: number;
  absence: number;
} {
  const { start, end } = input.period;
  const daysInPeriod = daysBetween(start, end);
  if (daysInPeriod < 28 || daysInPeriod > 31)
    throw new RangeError("la période doit couvrir un mois");
  const from = input.employee.hireDate > start ? input.employee.hireDate : start;
  const to = input.employee.endDate && input.employee.endDate < end ? input.employee.endDate : end;
  const contractDays = to < from ? 0 : daysBetween(from, to);
  const absence = input.unpaidAbsenceDays ?? 0;
  if (!Number.isSafeInteger(absence) || absence < 0)
    throw new RangeError("jours d'absence invalides");
  if (absence > contractDays)
    throw new RangeError("plus de jours d'absence que de jours sous contrat");
  return { days: contractDays - absence, daysInPeriod, absence };
}

/**
 * Calcule un bulletin de paie camerounais. Fonction pure : mêmes entrées et mêmes règles,
 * même bulletin, au franc près. Aucun taux n'est écrit ici : tout vient de `rules`.
 */
export function computePayslip(
  input: PayslipInput,
  rules: readonly PayRule[],
  options: { requireValidatedRules?: boolean } = {},
): Payslip {
  const date = input.period.end;
  const { baseSalary } = input.employee;
  assertFcfa(baseSalary, "salaire de base");
  assertBasisPoints(input.employer.workAccidentRate, "taux AT/MP");
  const items = input.items ?? [];
  for (const i of items) {
    assertFcfa(i.amount, i.label);
    if (i.amount < 0) throw new RangeError(`${i.label} : montant négatif`);
  }

  const used = new Map<string, PayRule>();
  const rule = <C extends RuleCode>(code: C) => {
    const r = resolveRule(rules, code, date);
    used.set(code, r);
    return r.value;
  };

  const lines: PayslipLine[] = [];
  const warnings: Payslip["warnings"] = [];

  // 1. Salaire de base, proratisé en cas d'entrée ou de sortie dans le mois.
  const presence = presenceDays(input);
  const proratedBase = mulDiv([baseSalary, presence.days], presence.daysInPeriod, "nearest");
  if (presence.days < presence.daysInPeriod) warnings.push("partial_month");
  lines.push({
    code: "base",
    label: "Salaire de base",
    section: "earning",
    amount: proratedBase,
    base: baseSalary,
    explanation:
      presence.days === presence.daysInPeriod
        ? `Salaire de base mensuel : ${money(baseSalary)}`
        : `${money(baseSalary)} × ${presence.days} / ${presence.daysInPeriod} jours de présence${presence.absence ? ` (dont ${presence.absence} j d'absence non payée déduits)` : ""}`,
  });

  // 2. Heures supplémentaires : salaire horaire × heures × (1 + majoration).
  let overtimeTotal = 0;
  if (input.overtime?.length) {
    const ot = rule(RULE_CODES.overtime);
    for (const o of input.overtime) {
      const rate = ot.rates[o.category];
      if (rate === undefined)
        throw new RangeError(`catégorie d'heures supplémentaires inconnue : ${o.category}`);
      if (!Number.isSafeInteger(o.hoursHundredths) || o.hoursHundredths < 0)
        throw new RangeError("heures invalides");
      const amount = mulDiv(
        [baseSalary, o.hoursHundredths, 10_000 + rate],
        ot.monthlyHoursHundredths * 10_000,
        ot.rounding,
      );
      overtimeTotal += amount;
      lines.push({
        code: `overtime.${o.category}`,
        label: `Heures supplémentaires majorées de ${pct(rate)}`,
        section: "earning",
        amount,
        rate,
        ruleCode: RULE_CODES.overtime,
        explanation: `${fr.format(o.hoursHundredths / 100)} h × (${money(baseSalary)} / ${fr.format(ot.monthlyHoursHundredths / 100)} h) × ${fr.format((10_000 + rate) / 10_000)}`,
      });
    }
  }

  // 3. Rubriques du mois.
  const sum = (pred: (i: PayItemInput) => boolean) =>
    items.filter(pred).reduce((s, i) => s + i.amount, 0);
  for (const i of items) {
    const section: PayslipSection =
      i.kind === "deduction"
        ? "deduction"
        : i.kind === "non_taxable_allowance"
          ? "allowance"
          : "earning";
    const flags =
      i.kind === "earning" || i.kind === "in_kind"
        ? ` (${i.subjectToCnps ? "soumis" : "non soumis"} CNPS, ${i.taxable ? "imposable" : "non imposable"})`
        : "";
    lines.push({
      code: `item.${i.code}`,
      label: i.label,
      section,
      amount: i.amount,
      explanation: `${i.kind === "in_kind" ? "Avantage en nature, non versé" : "Montant saisi"}${flags}`,
    });
  }
  const inBrut = (i: PayItemInput) => i.kind === "earning" || i.kind === "in_kind";
  const inKind = sum((i) => i.kind === "in_kind");
  const nonTaxableAllowances = sum((i) => i.kind === "non_taxable_allowance");
  const deductions = sum((i) => i.kind === "deduction");
  const gross = proratedBase + overtimeTotal + sum(inBrut);
  const cnpsBase = proratedBase + overtimeTotal + sum((i) => inBrut(i) && i.subjectToCnps);
  const taxableGross = proratedBase + overtimeTotal + sum((i) => inBrut(i) && i.taxable);

  // 4. CNPS.
  const cnps = computeCnps(
    {
      brut: cnpsBase,
      periodDate: date,
      regime: input.employer.regime,
      workAccidentRate: input.employer.workAccidentRate,
    },
    rules,
  );
  rule(RULE_CODES.cnpsWorkAccident); // résolue par computeCnps ; notée ici pour l'instantané
  const pension = rule(RULE_CODES.cnpsPension);
  const family = rule(RULE_CODES.cnpsFamily);
  const familyRate = family.employerRateByRegime[input.employer.regime];
  const capNote =
    cnpsBase > pension.monthlyCeiling ? ` (plafonné à ${money(pension.monthlyCeiling)})` : "";
  lines.push(
    {
      code: "cnps.pension.employee",
      label: "CNPS pension vieillesse (part salariale)",
      section: "employee_contribution",
      amount: cnps.pensionEmployee,
      base: cnps.cappedBase,
      rate: pension.employeeRate,
      ruleCode: RULE_CODES.cnpsPension,
      explanation: `${pct(pension.employeeRate)} × ${money(cnps.cappedBase)}${capNote}`,
    },
    {
      code: "cnps.pension.employer",
      label: "CNPS pension vieillesse (part patronale)",
      section: "employer_contribution",
      amount: cnps.pensionEmployer,
      base: cnps.cappedBase,
      rate: pension.employerRate,
      ruleCode: RULE_CODES.cnpsPension,
      explanation: `${pct(pension.employerRate)} × ${money(cnps.cappedBase)}${capNote}`,
    },
    {
      code: "cnps.family",
      label: "CNPS prestations familiales",
      section: "employer_contribution",
      amount: cnps.familyEmployer,
      base: Math.min(cnpsBase, family.monthlyCeiling),
      rate: familyRate,
      ruleCode: RULE_CODES.cnpsFamily,
      explanation: `${pct(familyRate)} × ${money(Math.min(cnpsBase, family.monthlyCeiling))}`,
    },
    {
      code: "cnps.work_accident",
      label: "CNPS accidents du travail",
      section: "employer_contribution",
      amount: cnps.workAccidentEmployer,
      base: cnpsBase,
      rate: input.employer.workAccidentRate,
      ruleCode: RULE_CODES.cnpsWorkAccident,
      explanation: `${pct(input.employer.workAccidentRate)} × ${money(cnpsBase)} (totalité du salaire)`,
    },
  );

  // 5. IRPP : brut imposable − frais professionnels − CNPS salariale, annualisé, − abattement annuel.
  const irppRule = rule(RULE_CODES.irpp);
  const rawExpenses = applyRate(taxableGross, irppRule.professionalExpensesRate, "down");
  const expenses =
    irppRule.professionalExpensesMonthlyCap === null
      ? rawExpenses
      : Math.min(rawExpenses, irppRule.professionalExpensesMonthlyCap);
  const netTaxableMonthly = Math.max(0, taxableGross - expenses - cnps.pensionEmployee);
  const irppAnnualBase = Math.max(0, netTaxableMonthly * 12 - irppRule.annualAllowance);
  const belowThreshold = taxableGross < irppRule.monthlyExemptionThreshold;
  if (belowThreshold) warnings.push("irpp_below_threshold");
  const irpp = belowThreshold
    ? 0
    : progressiveTax(irppRule.brackets, irppAnnualBase, irppRule.rounding, 12);
  lines.push({
    code: "irpp",
    label: "IRPP",
    section: "employee_contribution",
    amount: irpp,
    base: irppAnnualBase,
    ruleCode: RULE_CODES.irpp,
    explanation: belowThreshold
      ? `Brut imposable ${money(taxableGross)} inférieur au seuil de ${money(irppRule.monthlyExemptionThreshold)} : pas d'IRPP`
      : `(${money(taxableGross)} − frais professionnels ${money(expenses)} − CNPS ${money(cnps.pensionEmployee)}) × 12 − ${money(irppRule.annualAllowance)} = ${money(irppAnnualBase)} ; barème annuel ÷ 12`,
  });

  // 6. CAC : pourcentage de l'IRPP.
  const cacRule = rule(RULE_CODES.cac);
  const cac = applyRate(irpp, cacRule.rateOfIrpp, cacRule.rounding);
  lines.push({
    code: "cac",
    label: "Centimes additionnels communaux (CAC)",
    section: "employee_contribution",
    amount: cac,
    base: irpp,
    rate: cacRule.rateOfIrpp,
    ruleCode: RULE_CODES.cac,
    explanation: `${pct(cacRule.rateOfIrpp)} × IRPP ${money(irpp)}`,
  });

  // 7. CFC et FNE sur le brut imposable.
  const cfcRule = rule(RULE_CODES.cfc);
  const fneRule = rule(RULE_CODES.fne);
  const cfcEmployee = applyRate(taxableGross, cfcRule.employeeRate, cfcRule.rounding);
  const cfcEmployer = applyRate(taxableGross, cfcRule.employerRate, cfcRule.rounding);
  const fne = applyRate(taxableGross, fneRule.employerRate, fneRule.rounding);
  lines.push(
    {
      code: "cfc.employee",
      label: "Crédit foncier (part salariale)",
      section: "employee_contribution",
      amount: cfcEmployee,
      base: taxableGross,
      rate: cfcRule.employeeRate,
      ruleCode: RULE_CODES.cfc,
      explanation: `${pct(cfcRule.employeeRate)} × ${money(taxableGross)}`,
    },
    {
      code: "cfc.employer",
      label: "Crédit foncier (part patronale)",
      section: "employer_contribution",
      amount: cfcEmployer,
      base: taxableGross,
      rate: cfcRule.employerRate,
      ruleCode: RULE_CODES.cfc,
      explanation: `${pct(cfcRule.employerRate)} × ${money(taxableGross)}`,
    },
    {
      code: "fne",
      label: "Fonds national de l'emploi",
      section: "employer_contribution",
      amount: fne,
      base: taxableGross,
      rate: fneRule.employerRate,
      ruleCode: RULE_CODES.fne,
      explanation: `${pct(fneRule.employerRate)} × ${money(taxableGross)}`,
    },
  );

  // 8. RAV (sur le brut imposable) et TDL (sur le salaire de base mensuel).
  const rav = bracketAmount(rule(RULE_CODES.rav).brackets, taxableGross);
  const tdl = bracketAmount(rule(RULE_CODES.tdl).brackets, baseSalary);
  lines.push(
    {
      code: "rav",
      label: "Redevance audiovisuelle (RAV)",
      section: "employee_contribution",
      amount: rav,
      base: taxableGross,
      ruleCode: RULE_CODES.rav,
      explanation: `Barème par tranche, brut imposable ${money(taxableGross)}`,
    },
    {
      code: "tdl",
      label: "Taxe de développement local (TDL)",
      section: "employee_contribution",
      amount: tdl,
      base: baseSalary,
      ruleCode: RULE_CODES.tdl,
      explanation: `Barème par tranche, salaire de base ${money(baseSalary)}`,
    },
  );

  // 9. Totaux.
  const employeeContributions = cnps.pensionEmployee + irpp + cac + cfcEmployee + rav + tdl;
  const employerContributions = cnps.totalEmployer + cfcEmployer + fne;
  const netPay = gross - inKind + nonTaxableAllowances - employeeContributions - deductions;
  if (netPay < 0) warnings.push("net_negative");
  const employerCost = gross + nonTaxableAllowances + employerContributions;

  const rulesUsed: RuleRef[] = [...used.values()]
    .map((r) => ({
      ...(r.id ? { id: r.id } : {}),
      code: r.code,
      validFrom: r.validFrom,
      status: r.status ?? "draft",
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
  if (options.requireValidatedRules) assertValidated([...used.values()]);

  return {
    period: input.period,
    presence,
    lines,
    totals: {
      gross,
      cnpsBase,
      taxableGross,
      inKind,
      nonTaxableAllowances,
      employeeContributions,
      employerContributions,
      deductions,
      netTaxableMonthly,
      irppAnnualBase,
      netPay,
      employerCost,
    },
    rulesUsed,
    warnings,
  };
}
