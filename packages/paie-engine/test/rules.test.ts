import { describe, expect, it } from "vitest";
import { assertValidated, checkRuleSet, resolveRule, type PayRule } from "../src";

const cac = (rate: number) => ({ rateOfIrpp: rate, rounding: "nearest" });
const rules: PayRule[] = [
  { code: "cac", validFrom: "2025-01-01", validTo: "2025-12-31", value: cac(1000) },
  { code: "cac", validFrom: "2026-01-01", validTo: null, value: cac(1100) },
  {
    code: "fne",
    validFrom: "2026-01-01",
    validTo: null,
    value: { employerRate: 100, rounding: "nearest" },
  },
  {
    code: "fne",
    validFrom: "2026-06-01",
    validTo: null,
    value: { employerRate: 200, rounding: "nearest" },
  },
];

describe("resolveRule", () => {
  it("choisit la règle en vigueur, bornes incluses", () => {
    expect(resolveRule(rules, "cac", "2025-01-01").value.rateOfIrpp).toBe(1000);
    expect(resolveRule(rules, "cac", "2025-12-31").value.rateOfIrpp).toBe(1000);
    expect(resolveRule(rules, "cac", "2026-01-01").value.rateOfIrpp).toBe(1100);
    expect(resolveRule(rules, "cac", "2031-07-15").value.rateOfIrpp).toBe(1100);
  });
  it("échoue si aucune règle ne s'applique", () => {
    expect(() => resolveRule(rules, "cac", "2024-12-31")).toThrow(/aucune règle/);
    expect(() => resolveRule(rules, "rav", "2026-01-01")).toThrow(/aucune règle/);
  });
  it("échoue si deux règles se chevauchent", () => {
    expect(() => resolveRule(rules, "fne", "2026-07-01")).toThrow(/se chevauchent/);
  });
  it("refuse une date mal formée", () => {
    expect(() => resolveRule(rules, "cac", "01/01/2026")).toThrow(/date ISO invalide/);
  });
  it("refuse une valeur non conforme à son schéma (ex. taux décimal)", () => {
    const bad: PayRule[] = [
      { code: "cac", validFrom: "2026-01-01", validTo: null, value: cac(10.5) },
    ];
    expect(() => resolveRule(bad, "cac", "2026-02-01")).toThrow(/invalide/);
  });
});

describe("checkRuleSet", () => {
  const tdl = (brackets: unknown) => ({
    code: "tdl",
    validFrom: "2026-01-01",
    validTo: null,
    value: { brackets },
  });

  it("accepte un référentiel cohérent", () => {
    expect(checkRuleSet(rules.slice(0, 3))).toEqual([]);
  });

  it("signale code inconnu, dates invalides, chevauchement et trou", () => {
    const issues = checkRuleSet([
      { code: "inconnu", validFrom: "2026-01-01", validTo: null, value: {} },
      { code: "cac", validFrom: "2026-02-01", validTo: "2026-01-01", value: cac(1000) },
      {
        code: "cfc",
        validFrom: "2025-01-01",
        validTo: "2025-06-30",
        value: { employeeRate: 100, employerRate: 150, rounding: "nearest" },
      },
      {
        code: "cfc",
        validFrom: "2025-08-01",
        validTo: null,
        value: { employeeRate: 100, employerRate: 150, rounding: "nearest" },
      },
      ...rules.slice(2),
    ]);
    expect(issues.map((i) => [i.code, i.problem])).toEqual([
      ["inconnu", "unknown_code"],
      ["cac", "invalid_dates"],
      ["cfc", "gap"],
      ["fne", "overlap"],
    ]);
  });

  it("vérifie les tranches : départ à 0, contiguës, dernière ouverte", () => {
    const ok = [
      { from: 0, to: 61_999, amount: 0 },
      { from: 62_000, to: null, amount: 250 },
    ];
    expect(checkRuleSet([tdl(ok)])).toEqual([]);
    const problems = (b: unknown) => checkRuleSet([tdl(b)])[0]?.detail ?? "";
    expect(problems([{ from: 1, to: null, amount: 0 }])).toMatch(/commence à 0/);
    expect(
      problems([
        { from: 0, to: 100, amount: 0 },
        { from: 150, to: null, amount: 1 },
      ]),
    ).toMatch(/non contiguës/);
    expect(problems([{ from: 0, to: 100, amount: 0 }])).toMatch(
      /dernière tranche doit être ouverte/,
    );
    expect(
      problems([
        { from: 0, to: null, amount: 0 },
        { from: 1, to: null, amount: 1 },
      ]),
    ).toMatch(/seule la dernière/);
    expect(
      problems([
        { from: 0, to: 10, amount: 0 },
        { from: 11, to: 5, amount: 0 },
        { from: 6, to: null, amount: 0 },
      ]),
    ).toMatch(/inversée/);
  });
});

describe("assertValidated", () => {
  it("refuse une règle en brouillon, accepte des règles validées", () => {
    const validated = rules.map((r) => ({ ...r, status: "validated" as const }));
    expect(() => assertValidated(validated)).not.toThrow();
    const draft: PayRule = {
      code: "cac",
      validFrom: "2025-01-01",
      validTo: null,
      value: cac(1000),
      status: "draft",
    };
    expect(() => assertValidated([...validated, draft])).toThrow(/cac \(2025-01-01\)/);
    expect(() => assertValidated(rules)).toThrow(/non validées/);
  });
});
