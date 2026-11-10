import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { computePayslip, type PayRule, type PayslipInput } from "../src";
import { loadRuleFile } from "../rules/load";

/**
 * Cas de CONTRÔLE, pas golden : ils vérifient que le moteur applique fidèlement le référentiel
 * brouillon 2026. Les montants attendus ont été calculés indépendamment (à la main pour le cas 1,
 * en Python avec des fractions exactes pour le cas 2). Ils ne prouvent rien sur la justesse
 * des taux eux-mêmes, qui reste à valider par l'expert-comptable.
 */
const rules: PayRule[] = loadRuleFile(
  new URL("../rules/cm-2026.draft.json", import.meta.url).pathname,
);

const march: PayslipInput["period"] = { start: "2026-03-01", end: "2026-03-31" };
const input = (over: Partial<PayslipInput> = {}): PayslipInput => ({
  period: march,
  employer: { regime: "general", workAccidentRate: 175 },
  employee: { baseSalary: 400_000, hireDate: "2024-01-15", endDate: null },
  ...over,
});
const amount = (p: ReturnType<typeof computePayslip>, code: string) =>
  p.lines.find((l) => l.code === code)?.amount;

describe("cas de contrôle 1 : 400 000 FCFA, mois complet, sans variable", () => {
  const p = computePayslip(input(), rules);

  it("calcule chaque ligne", () => {
    expect(Object.fromEntries(p.lines.map((l) => [l.code, l.amount]))).toEqual({
      base: 400_000,
      "cnps.pension.employee": 16_800,
      "cnps.pension.employer": 16_800,
      "cnps.family": 28_000,
      "cnps.work_accident": 7_000,
      // (400 000 − 120 000 − 16 800) × 12 − 500 000 = 2 658 400 → 298 760 / an → 24 896 / mois
      irpp: 24_896,
      cac: 2_489,
      "cfc.employee": 4_000,
      "cfc.employer": 6_000,
      fne: 4_000,
      rav: 4_550,
      tdl: 2_250,
    });
  });

  it("calcule les totaux", () => {
    expect(p.totals).toMatchObject({
      gross: 400_000,
      netTaxableMonthly: 263_200,
      irppAnnualBase: 2_658_400,
      employeeContributions: 54_985,
      employerContributions: 61_800,
      netPay: 345_015,
      employerCost: 461_800,
    });
    expect(p.warnings).toEqual([]);
  });

  it("garde l'instantané des règles et un détail lisible par ligne", () => {
    expect(p.rulesUsed.map((r) => r.code)).toEqual([
      "cac",
      "cfc",
      "cnps.accidents_travail",
      "cnps.pension",
      "cnps.prestations_familiales",
      "fne",
      "irpp.bareme",
      "rav",
      "smig",
      "tdl",
    ]);
    expect(p.rulesUsed.every((r) => r.status === "draft" && r.validFrom === "2026-01-01")).toBe(
      true,
    );
    // Le format français sépare les milliers par une espace fine insécable (U+202F).
    const text = (code: string) =>
      p.lines.find((l) => l.code === code)?.explanation.replace(/\u202f/g, " ");
    expect(text("irpp")).toContain("= 2 658 400 FCFA");
    expect(text("cac")).toBe("10 % × IRPP 24 896 FCFA");
  });
});

describe("cas de contrôle 2 : embauche le 16 mars, heures sup, primes, avantage en nature, avance", () => {
  const p = computePayslip(
    input({
      employee: { baseSalary: 310_000, hireDate: "2026-03-16", endDate: null },
      overtime: [{ category: "hs_20", hoursHundredths: 800 }],
      items: [
        {
          code: "prime_rendement",
          label: "Prime de rendement",
          kind: "earning",
          amount: 20_000,
          subjectToCnps: true,
          taxable: true,
        },
        {
          code: "logement",
          label: "Avantage en nature logement",
          kind: "in_kind",
          amount: 30_000,
          subjectToCnps: true,
          taxable: true,
        },
        {
          code: "transport",
          label: "Indemnité de transport",
          kind: "non_taxable_allowance",
          amount: 15_000,
          subjectToCnps: false,
          taxable: false,
        },
        {
          code: "avance",
          label: "Avance sur salaire",
          kind: "deduction",
          amount: 10_000,
          subjectToCnps: false,
          taxable: false,
        },
      ],
    }),
    rules,
  );

  it("proratise, majore et ventile chaque rubrique", () => {
    expect(p.presence).toEqual({ days: 16, daysInPeriod: 31, absence: 0 });
    expect(amount(p, "base")).toBe(160_000);
    expect(amount(p, "overtime.hs_20")).toBe(17_170);
    expect(p.totals).toMatchObject({
      gross: 227_170,
      cnpsBase: 227_170,
      taxableGross: 227_170,
      inKind: 30_000,
      nonTaxableAllowances: 15_000,
      deductions: 10_000,
      netTaxableMonthly: 149_478,
      irppAnnualBase: 1_293_736,
    });
  });

  it("donne le net et le coût employeur attendus (calcul Python indépendant)", () => {
    expect(amount(p, "cnps.pension.employee")).toBe(9_541);
    expect(amount(p, "irpp")).toBe(10_781);
    expect(amount(p, "cac")).toBe(1_078);
    expect(amount(p, "rav")).toBe(3_250);
    expect(amount(p, "tdl")).toBe(2_250);
    expect(p.totals.employeeContributions).toBe(29_172);
    expect(p.totals.netPay).toBe(172_998);
    expect(p.totals.employerCost).toBe(277_268);
    expect(p.warnings).toEqual(["partial_month"]);
    expect(p.rulesUsed.map((r) => r.code)).toContain("heures_sup.majorations");
  });
});

describe("règles particulières", () => {
  it("pas d'IRPP sous le seuil d'exonération", () => {
    const p = computePayslip(
      input({ employee: { baseSalary: 61_999, hireDate: "2020-01-01", endDate: null } }),
      rules,
    );
    expect(amount(p, "irpp")).toBe(0);
    expect(amount(p, "cac")).toBe(0);
    expect(amount(p, "tdl")).toBe(0);
    expect(p.warnings).toContain("irpp_below_threshold");
  });

  it("plafonne la pension CNPS mais pas les accidents du travail", () => {
    const p = computePayslip(
      input({ employee: { baseSalary: 2_000_000, hireDate: "2020-01-01", endDate: null } }),
      rules,
    );
    expect(amount(p, "cnps.pension.employee")).toBe(31_500);
    expect(amount(p, "cnps.work_accident")).toBe(35_000);
    expect(p.lines.find((l) => l.code === "cnps.pension.employee")?.explanation).toContain(
      "plafonné",
    );
    expect(amount(p, "rav")).toBe(13_000);
    expect(amount(p, "tdl")).toBe(2_500);
  });

  it("une prime non soumise à CNPS n'entre pas dans l'assiette CNPS", () => {
    const p = computePayslip(
      input({
        items: [
          {
            code: "p",
            label: "Prime",
            kind: "earning",
            amount: 50_000,
            subjectToCnps: false,
            taxable: true,
          },
        ],
      }),
      rules,
    );
    expect(p.totals.cnpsBase).toBe(400_000);
    expect(p.totals.taxableGross).toBe(450_000);
  });

  it("plafond des frais professionnels, prime non imposable et identifiants de règles", () => {
    const capped: PayRule[] = rules.map((r, i) => ({
      ...r,
      id: `rule-${i}`,
      ...(r.code === "irpp.bareme"
        ? { value: { ...(r.value as object), professionalExpensesMonthlyCap: 50_000 } }
        : {}),
    }));
    const p = computePayslip(
      input({
        items: [
          {
            code: "g",
            label: "Gratification",
            kind: "earning",
            amount: 10_000,
            subjectToCnps: true,
            taxable: false,
          },
        ],
      }),
      capped,
    );
    // Frais plafonnés à 50 000 au lieu de 120 000 : 400 000 − 50 000 − CNPS 17 220
    expect(p.totals.netTaxableMonthly).toBe(332_780);
    expect(p.lines.find((l) => l.code === "item.g")?.explanation).toContain("non imposable");
    expect(p.rulesUsed.every((r) => r.id?.startsWith("rule-"))).toBe(true);
  });

  it("déduit les jours d'absence non payée", () => {
    const p = computePayslip(input({ unpaidAbsenceDays: 3 }), rules);
    // 400 000 × 28 / 31 = 361 290,3
    expect(amount(p, "base")).toBe(361_290);
    expect(p.presence).toEqual({ days: 28, daysInPeriod: 31, absence: 3 });
    expect(p.lines[0]?.explanation).toContain("3 j d'absence");
    expect(() => computePayslip(input({ unpaidAbsenceDays: 32 }), rules)).toThrow(/plus de jours/);
    expect(() => computePayslip(input({ unpaidAbsenceDays: -1 }), rules)).toThrow(/invalides/);
  });

  it("sortie en cours de mois et salarié absent tout le mois", () => {
    const left = computePayslip(
      input({ employee: { baseSalary: 300_000, hireDate: "2020-01-01", endDate: "2026-03-10" } }),
      rules,
    );
    expect(amount(left, "base")).toBe(96_774);
    const gone = computePayslip(
      input({ employee: { baseSalary: 300_000, hireDate: "2020-01-01", endDate: "2026-02-28" } }),
      rules,
    );
    expect(amount(gone, "base")).toBe(0);
  });

  it("applique les règles en vigueur à la fin de la période", () => {
    const later: PayRule[] = [
      ...rules.map((r) => (r.code === "cac" ? { ...r, validTo: "2026-03-31" } : r)),
      {
        code: "cac",
        validFrom: "2026-04-01",
        validTo: null,
        value: { rateOfIrpp: 2000, rounding: "down" },
      },
    ];
    expect(amount(computePayslip(input(), later), "cac")).toBe(2_489);
    const april = computePayslip(
      input({ period: { start: "2026-04-01", end: "2026-04-30" } }),
      later,
    );
    expect(amount(april, "cac")).toBe(4_979);
  });

  it("refuse les règles en brouillon quand la production l'exige", () => {
    expect(() => computePayslip(input(), rules, { requireValidatedRules: true })).toThrow(
      /non validées/,
    );
    const validated = rules.map((r) => ({ ...r, status: "validated" as const }));
    expect(computePayslip(input(), validated, { requireValidatedRules: true }).totals.netPay).toBe(
      345_015,
    );
  });

  it("signale un net négatif sans le masquer", () => {
    const p = computePayslip(
      input({
        items: [
          {
            code: "pret",
            label: "Prêt",
            kind: "deduction",
            amount: 500_000,
            subjectToCnps: false,
            taxable: false,
          },
        ],
      }),
      rules,
    );
    expect(p.totals.netPay).toBeLessThan(0);
    expect(p.warnings).toContain("net_negative");
  });

  it("une rubrique peut porter sa propre explication (ex. échéance de prêt automatique)", () => {
    const p = computePayslip(
      input({
        items: [
          {
            code: "loan:x",
            label: "Prêt — échéance 1/3",
            kind: "deduction",
            amount: 10_000,
            subjectToCnps: false,
            taxable: false,
            explanation: "Échéance automatique du prêt",
          },
        ],
      }),
      rules,
    );
    expect(p.lines.find((l) => l.code === "item.loan:x")?.explanation).toBe(
      "Échéance automatique du prêt",
    );
  });

  it("SMIG : avertit quand le salaire de base mensuel est inférieur, pas au montant exact", () => {
    const at = (baseSalary: number) =>
      computePayslip(
        input({ employee: { baseSalary, hireDate: "2024-01-15", endDate: null } }),
        rules,
      ).warnings;
    expect(at(64_999)).toContain("below_minimum_wage");
    expect(at(65_000)).not.toContain("below_minimum_wage");
    // Une entrée en cours de mois proratise le salaire, mais c'est le salaire mensuel qui compte.
    const partial = computePayslip(
      input({ employee: { baseSalary: 65_000, hireDate: "2026-03-16", endDate: null } }),
      rules,
    );
    expect(partial.warnings).toContain("partial_month");
    expect(partial.warnings).not.toContain("below_minimum_wage");
  });

  it("plafond des retenues : avertit au-delà de la part retenable, au franc près", () => {
    // Net avant retenues du cas 1 : 345 015 FCFA ; part provisoire d'un tiers (3 333 bp, arrondi
    // inférieur) : 345 015 × 3 333 / 10 000 = 114 993.
    const withDeduction = (amount: number) =>
      computePayslip(
        input({
          items: [
            {
              code: "pret",
              label: "Prêt",
              kind: "deduction",
              amount,
              subjectToCnps: false,
              taxable: false,
            },
          ],
        }),
        rules,
      );
    expect(withDeduction(114_993).warnings).not.toContain("deductions_above_limit");
    expect(withDeduction(114_994).warnings).toContain("deductions_above_limit");
    expect(withDeduction(114_993).rulesUsed.map((r) => r.code)).toContain("retenues.plafond");
    // Sans retenue, la règle n'est pas utilisée (un brouillon ne rend pas le bulletin provisoire).
    expect(computePayslip(input(), rules).rulesUsed.map((r) => r.code)).not.toContain(
      "retenues.plafond",
    );
  });

  it("refuse les entrées invalides", () => {
    expect(() =>
      computePayslip(input({ period: { start: "2026-03-01", end: "2026-03-15" } }), rules),
    ).toThrow(/un mois/);
    expect(() =>
      computePayslip(input({ overtime: [{ category: "hs_99", hoursHundredths: 100 }] }), rules),
    ).toThrow(/inconnue/);
    expect(() =>
      computePayslip(input({ overtime: [{ category: "hs_20", hoursHundredths: -1 }] }), rules),
    ).toThrow(/heures/);
    expect(() =>
      computePayslip(
        input({
          items: [
            {
              code: "x",
              label: "X",
              kind: "earning",
              amount: -1,
              subjectToCnps: true,
              taxable: true,
            },
          ],
        }),
        rules,
      ),
    ).toThrow(/négatif/);
    expect(() =>
      computePayslip(
        input({ employee: { baseSalary: 1.5, hireDate: "2020-01-01", endDate: null } }),
        rules,
      ),
    ).toThrow();
  });
});

describe("propriétés", () => {
  const salary = fc.integer({ min: 0, max: 20_000_000 });

  it("aucun montant négatif, net ≤ brut versé, coût employeur ≥ brut", () => {
    fc.assert(
      fc.property(salary, fc.integer({ min: 0, max: 500_000 }), (base, prime) => {
        const p = computePayslip(
          input({
            employee: { baseSalary: base, hireDate: "2020-01-01", endDate: null },
            items: [
              {
                code: "p",
                label: "Prime",
                kind: "earning",
                amount: prime,
                subjectToCnps: true,
                taxable: true,
              },
            ],
          }),
          rules,
        );
        for (const l of p.lines) expect(l.amount, l.code).toBeGreaterThanOrEqual(0);
        expect(p.totals.netPay).toBeGreaterThanOrEqual(0);
        expect(p.totals.netPay).toBeLessThanOrEqual(p.totals.gross);
        expect(p.totals.employerCost).toBeGreaterThanOrEqual(p.totals.gross);
      }),
      { numRuns: 300 },
    );
  });

  it("l'IRPP et les retenues ne baissent jamais quand le salaire augmente", () => {
    fc.assert(
      fc.property(salary, fc.integer({ min: 1, max: 1_000_000 }), (base, raise) => {
        const at = (b: number) =>
          computePayslip(
            input({ employee: { baseSalary: b, hireDate: "2020-01-01", endDate: null } }),
            rules,
          );
        const lo = at(base);
        const hi = at(base + raise);
        expect(amount(hi, "irpp")).toBeGreaterThanOrEqual(amount(lo, "irpp") ?? 0);
        expect(hi.totals.employeeContributions).toBeGreaterThanOrEqual(
          lo.totals.employeeContributions,
        );
        expect(hi.totals.netPay).toBeGreaterThanOrEqual(lo.totals.netPay - 3_000);
      }),
      { numRuns: 300 },
    );
  });

  it("est déterministe", () => {
    expect(computePayslip(input(), rules)).toEqual(computePayslip(input(), rules));
  });
});
