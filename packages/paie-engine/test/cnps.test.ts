import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { computeCnps, type CnpsInput } from "../src";
import { testRules } from "./fixtures/rules";

const base: CnpsInput = {
  brut: 400_000,
  periodDate: "2026-03-31",
  regime: "general",
  workAccidentRate: 175,
};

describe("computeCnps", () => {
  it("salaire sous le plafond : assiette = brut", () => {
    const r = computeCnps(base, testRules);
    expect(r.cappedBase).toBe(400_000);
    expect(r.pensionEmployee).toBe(16_800);
    expect(r.pensionEmployer).toBe(16_800);
    expect(r.familyEmployer).toBe(28_000);
    expect(r.workAccidentEmployer).toBe(7_000);
    expect(r.totalEmployee).toBe(16_800);
    expect(r.totalEmployer).toBe(51_800);
  });

  it("salaire au plafond", () => {
    const r = computeCnps({ ...base, brut: 750_000 }, testRules);
    expect(r.cappedBase).toBe(750_000);
    expect(r.pensionEmployee).toBe(31_500);
  });

  it("salaire au-dessus : pension et PF plafonnées, AT/MP sur la totalité", () => {
    const r = computeCnps({ ...base, brut: 1_200_000, workAccidentRate: 500 }, testRules);
    expect(r.cappedBase).toBe(750_000);
    expect(r.pensionEmployee).toBe(31_500);
    expect(r.familyEmployer).toBe(52_500);
    expect(r.workAccidentEmployer).toBe(60_000);
  });

  it("changement de plafond à la date d'effet", () => {
    const before = computeCnps({ ...base, periodDate: "2025-12-31" }, testRules);
    const after = computeCnps({ ...base, periodDate: "2026-01-01" }, testRules);
    expect(before.cappedBase).toBe(300_000);
    expect(before.pensionEmployee).toBe(12_600);
    expect(after.cappedBase).toBe(400_000);
    expect(after.pensionEmployee).toBe(16_800);
  });

  it("applique le taux PF du régime", () => {
    expect(computeCnps({ ...base, regime: "agricole" }, testRules).familyEmployer).toBe(22_600);
    expect(computeCnps({ ...base, regime: "enseignement_prive" }, testRules).familyEmployer).toBe(
      14_800,
    );
  });

  it("refuse un brut invalide ou un taux AT/MP non notifiable", () => {
    expect(() => computeCnps({ ...base, brut: -1 }, testRules)).toThrow(RangeError);
    expect(() => computeCnps({ ...base, brut: 1.5 }, testRules)).toThrow(RangeError);
    expect(() => computeCnps({ ...base, workAccidentRate: 300 }, testRules)).toThrow(
      /AT\/MP non autorisé/,
    );
  });

  it("propriétés : cotisation salariale ≤ brut, rien de négatif, monotone en brut", () => {
    const brut = fc.integer({ min: 0, max: 50_000_000 });
    fc.assert(
      fc.property(brut, brut, (a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        const rLo = computeCnps({ ...base, brut: lo }, testRules);
        const rHi = computeCnps({ ...base, brut: hi }, testRules);
        for (const v of Object.values(rLo)) expect(v).toBeGreaterThanOrEqual(0);
        expect(rLo.totalEmployee).toBeLessThanOrEqual(lo);
        expect(rLo.totalEmployee).toBeLessThanOrEqual(rHi.totalEmployee);
        expect(rLo.totalEmployer).toBeLessThanOrEqual(rHi.totalEmployer);
      }),
    );
  });
});
