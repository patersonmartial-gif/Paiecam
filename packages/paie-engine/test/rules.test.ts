import { describe, expect, it } from "vitest";
import { resolveRule, type PayRule } from "../src";

const rules: PayRule[] = [
  { code: "x", validFrom: "2025-01-01", validTo: "2025-12-31", value: 1 },
  { code: "x", validFrom: "2026-01-01", validTo: null, value: 2 },
  { code: "y", validFrom: "2026-01-01", validTo: null, value: 3 },
  { code: "y", validFrom: "2026-06-01", validTo: null, value: 4 },
];

describe("resolveRule", () => {
  it("choisit la règle en vigueur, bornes incluses", () => {
    expect(resolveRule(rules, "x", "2025-01-01").value).toBe(1);
    expect(resolveRule(rules, "x", "2025-12-31").value).toBe(1);
    expect(resolveRule(rules, "x", "2026-01-01").value).toBe(2);
    expect(resolveRule(rules, "x", "2031-07-15").value).toBe(2);
  });
  it("échoue si aucune règle ne s'applique", () => {
    expect(() => resolveRule(rules, "x", "2024-12-31")).toThrow(/aucune règle/);
    expect(() => resolveRule(rules, "z", "2026-01-01")).toThrow(/aucune règle/);
  });
  it("échoue si deux règles se chevauchent", () => {
    expect(() => resolveRule(rules, "y", "2026-07-01")).toThrow(/se chevauchent/);
  });
  it("refuse une date mal formée", () => {
    expect(() => resolveRule(rules, "x", "01/01/2026")).toThrow(/date ISO invalide/);
  });
});
