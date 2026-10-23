import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { applyRate, assertFcfa, divRound } from "../src";

describe("divRound", () => {
  it("renvoie le quotient exact sans reste", () => {
    expect(divRound(100, 10, "nearest")).toBe(10);
  });
  it("arrondit selon la règle", () => {
    expect(divRound(15, 10, "down")).toBe(1);
    expect(divRound(11, 10, "up")).toBe(2);
    expect(divRound(15, 10, "nearest")).toBe(2);
    expect(divRound(14, 10, "nearest")).toBe(1);
  });
  it("refuse un dénominateur nul ou négatif", () => {
    expect(() => divRound(1, 0, "down")).toThrow(RangeError);
  });
});

describe("applyRate", () => {
  it("calcule 4,2 % de 750 000 FCFA", () => {
    expect(applyRate(750_000, 420)).toBe(31_500);
  });
  it("arrondit au franc le plus proche par défaut", () => {
    // 123 457 × 4,2 % = 5 185,194
    expect(applyRate(123_457, 420)).toBe(5_185);
  });
  it("refuse les montants non entiers et les taux hors bornes", () => {
    expect(() => applyRate(100.5, 420)).toThrow(RangeError);
    expect(() => applyRate(100, 10_001)).toThrow(RangeError);
    expect(() => applyRate(100, -1)).toThrow(RangeError);
    expect(() => applyRate(100, 4.2)).toThrow(RangeError);
  });
  it("encadre le résultat entre l'arrondi inférieur et supérieur", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000_000 }),
        fc.integer({ min: 0, max: 10_000 }),
        (a, r) => {
          const down = applyRate(a, r, "down");
          const up = applyRate(a, r, "up");
          const near = applyRate(a, r, "nearest");
          expect(Number.isInteger(near)).toBe(true);
          expect(down).toBeLessThanOrEqual(near);
          expect(near).toBeLessThanOrEqual(up);
          expect(up - down).toBeLessThanOrEqual(1);
        },
      ),
    );
  });
});

describe("assertFcfa", () => {
  it("accepte un entier et refuse un flottant", () => {
    expect(() => assertFcfa(1)).not.toThrow();
    expect(() => assertFcfa(0.1)).toThrow(/entier FCFA/);
  });
});
