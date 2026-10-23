import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { bracketAmount, mulDiv, progressiveTax } from "../src";

const irpp = [
  { from: 0, to: 2_000_000, rate: 1000 },
  { from: 2_000_001, to: 3_000_000, rate: 1500 },
  { from: 3_000_001, to: 5_000_000, rate: 2500 },
  { from: 5_000_001, to: null, rate: 3500 },
];
const rav = [
  { from: 0, to: 50_000, amount: 0 },
  { from: 50_001, to: 100_000, amount: 750 },
  { from: 100_001, to: null, amount: 1950 },
];

describe("progressiveTax", () => {
  it("applique chaque taux à sa seule tranche", () => {
    expect(progressiveTax(irpp, 0, "down")).toBe(0);
    expect(progressiveTax(irpp, -5, "down")).toBe(0);
    expect(progressiveTax(irpp, 2_000_000, "down")).toBe(200_000);
    expect(progressiveTax(irpp, 2_500_000, "down")).toBe(275_000);
    expect(progressiveTax(irpp, 3_000_000, "down")).toBe(350_000);
    expect(progressiveTax(irpp, 5_000_000, "down")).toBe(850_000);
    expect(progressiveTax(irpp, 6_000_000, "down")).toBe(1_200_000);
  });

  it("divise par 12 avec un seul arrondi final", () => {
    // 2 658 400 → 200 000 + 658 400 × 15 % = 298 760 par an → 24 896,67 par mois
    expect(progressiveTax(irpp, 2_658_400, "down", 12)).toBe(24_896);
    expect(progressiveTax(irpp, 2_658_400, "nearest", 12)).toBe(24_897);
  });

  it("est croissant et ne dépasse jamais le taux marginal maximal", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (a, d) => {
          const t = progressiveTax(irpp, a, "down");
          expect(progressiveTax(irpp, a + d, "down")).toBeGreaterThanOrEqual(t);
          expect(t).toBeLessThanOrEqual((a * 3500) / 10_000);
        },
      ),
    );
  });
});

describe("bracketAmount", () => {
  it("prend la tranche qui contient la valeur, bornes incluses", () => {
    expect(bracketAmount(rav, 0)).toBe(0);
    expect(bracketAmount(rav, 50_000)).toBe(0);
    expect(bracketAmount(rav, 50_001)).toBe(750);
    expect(bracketAmount(rav, 100_000)).toBe(750);
    expect(bracketAmount(rav, 10_000_000)).toBe(1950);
  });
  it("échoue hors des tranches", () => {
    expect(() => bracketAmount([{ from: 10, to: null, amount: 1 }], 5)).toThrow(/aucune tranche/);
  });
});

describe("mulDiv", () => {
  it("calcule sans dépassement ni flottant, avec arrondi", () => {
    // 100 000 000 × 20 000 × 15 000 dépasse Number.MAX_SAFE_INTEGER (valeur vérifiée en Python)
    expect(mulDiv([100_000_000, 20_000, 15_000], 173_330_000, "down")).toBe(173_080_251);
    expect(mulDiv([7, 1], 2, "down")).toBe(3);
    expect(mulDiv([7, 1], 2, "up")).toBe(4);
    expect(mulDiv([7, 1], 2, "nearest")).toBe(4);
    expect(mulDiv([5, 1], 5, "up")).toBe(1);
  });
  it("refuse un facteur non entier ou un dénominateur nul", () => {
    expect(() => mulDiv([1.5], 1, "down")).toThrow(/non entier/);
    expect(() => mulDiv([1], 0, "down")).toThrow(/positif/);
  });
});
