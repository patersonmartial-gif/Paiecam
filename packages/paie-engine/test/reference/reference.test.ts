import { describe, expect, it } from "vitest";
import { computePayslip } from "../../src";
import { loadCases } from "../golden/fixture";

/**
 * Cas publics (simulateurs, guides, exemples en ligne) : NON validés. Ils servent à repérer les
 * écarts à soumettre à l'expert-comptable, sans bloquer le build. Chaque écart est listé.
 */
const cases = loadCases(new URL("./cases/", import.meta.url));

describe("cas de référence publics (non bloquants)", () => {
  it("les fichiers sont lisibles", () => {
    expect(Array.isArray(cases)).toBe(true);
  });

  for (const { data, rules } of cases) {
    it(`${data.id} — écarts éventuels`, () => {
      const p = computePayslip(data.input, rules);
      const gaps = Object.entries(data.expected.lines)
        .map(([code, expected]) => ({
          code,
          expected,
          actual: p.lines.find((l) => l.code === code)?.amount,
        }))
        .filter((g) => g.actual !== g.expected);
      if (p.totals.netPay !== data.expected.netPay)
        gaps.push({ code: "netPay", expected: data.expected.netPay, actual: p.totals.netPay });
      if (gaps.length > 0)
        console.warn(`[référence ${data.id}] ${data.provenance.url ?? data.provenance.by} :`, gaps);
    });
  }
});
