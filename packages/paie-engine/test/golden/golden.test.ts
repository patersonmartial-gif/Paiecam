import { describe, expect, it } from "vitest";
import { computePayslip } from "../../src";
import { loadCases } from "./fixture";

/**
 * Bulletins réels anonymisés, validés par écrit par l'expert-comptable : le moteur doit les
 * reproduire au franc près. Tout changement du moteur ou du référentiel est rejoué contre eux.
 */
const cases = loadCases(new URL("./cases/", import.meta.url));

describe("bulletins golden", () => {
  it.todo(`${cases.length} / 30 bulletins validés fournis — en attente de l'expert-comptable`);

  for (const { file, data, rules } of cases) {
    it(`${data.id} — ${data.description} (${file})`, () => {
      const p = computePayslip(data.input, rules);
      for (const [code, expected] of Object.entries(data.expected.lines)) {
        expect(p.lines.find((l) => l.code === code)?.amount, code).toBe(expected);
      }
      expect(p.totals.netPay, "net à payer").toBe(data.expected.netPay);
      if (data.expected.employerCost !== undefined) {
        expect(p.totals.employerCost, "coût employeur").toBe(data.expected.employerCost);
      }
    });
  }
});
