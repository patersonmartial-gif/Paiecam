import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  aggregateDeclarations,
  computePayslip,
  declarationDueDate,
  resolveRule,
  type DeclaredPayslip,
  type PayslipInput,
} from "../src";
import { loadRuleFile } from "../rules/load";

const rules = loadRuleFile(new URL("../rules/cm-2026.draft.json", import.meta.url).pathname);
const slip = (id: string, base: number, over: Partial<PayslipInput> = {}): DeclaredPayslip => {
  const p = computePayslip(
    {
      period: { start: "2026-03-01", end: "2026-03-31" },
      employer: { regime: "general", workAccidentRate: 175 },
      employee: { baseSalary: base, hireDate: "2024-01-01", endDate: null },
      ...over,
    },
    rules,
  );
  return {
    employeeId: id,
    gross: p.totals.gross,
    netPay: p.totals.netPay,
    employerCost: p.totals.employerCost,
    lines: p.lines,
  };
};

describe("aggregateDeclarations", () => {
  it("reprend les montants du cas de contrôle 1", () => {
    const t = aggregateDeclarations([slip("e1", 400_000)]);
    expect(t).toMatchObject({
      headcount: 1,
      gross: 400_000,
      cnpsCappedBase: 400_000,
      cnps: {
        pensionEmployee: 16_800,
        pensionEmployer: 16_800,
        family: 28_000,
        workAccident: 7_000,
        total: 68_600,
      },
      dgi: {
        irpp: 24_896,
        cac: 2_489,
        cfcEmployee: 4_000,
        cfcEmployer: 6_000,
        fne: 4_000,
        rav: 4_550,
        tdl: 2_250,
        total: 48_185,
      },
      netPay: 345_015,
      employerCost: 461_800,
    });
  });

  it("additionne plusieurs salariés et garde l'assiette plafonnée", () => {
    const t = aggregateDeclarations([slip("e1", 400_000), slip("e2", 2_000_000)]);
    expect(t.headcount).toBe(2);
    expect(t.cnpsCappedBase).toBe(400_000 + 750_000);
    expect(t.employees.map((e) => e.employeeId)).toEqual(["e1", "e2"]);
  });

  it("tolère un bulletin sans ligne de pension (assiette nulle)", () => {
    const t = aggregateDeclarations([
      { employeeId: "x", gross: 0, netPay: 0, employerCost: 0, lines: [] },
    ]);
    expect(t.cnpsCappedBase).toBe(0);
  });

  it("un mois sans bulletin donne des totaux nuls", () => {
    expect(aggregateDeclarations([])).toMatchObject({
      headcount: 0,
      gross: 0,
      cnps: { total: 0 },
      dgi: { total: 0 },
    });
  });

  it("propriété : chaque total est exactement la somme des lignes des bulletins", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 5_000_000 }), { maxLength: 12 }), (bases) => {
        const slips = bases.map((b, i) => slip(`e${i}`, b));
        const t = aggregateDeclarations(slips);
        const sum = (code: string) =>
          slips
            .flatMap((s) => s.lines)
            .filter((l) => l.code === code)
            .reduce((a, l) => a + l.amount, 0);
        expect(t.dgi.irpp).toBe(sum("irpp"));
        expect(t.dgi.rav).toBe(sum("rav"));
        expect(t.cnps.family).toBe(sum("cnps.family"));
        expect(t.cnps.total).toBe(t.employees.reduce((a, e) => a + e.cnps.total, 0));
        expect(t.dgi.total).toBe(
          t.dgi.irpp +
            t.dgi.cac +
            t.dgi.cfcEmployee +
            t.dgi.cfcEmployer +
            t.dgi.fne +
            t.dgi.rav +
            t.dgi.tdl,
        );
        expect(t.netPay).toBe(slips.reduce((a, s) => a + s.netPay, 0));
      }),
      { numRuns: 200 },
    );
  });
});

describe("declarationDueDate", () => {
  it("le 15 du mois suivant, y compris en décembre (référentiel brouillon)", () => {
    const r = resolveRule(rules, "echeances", "2026-03-31").value;
    expect(declarationDueDate(r, 2026, 3, "dgi")).toBe("2026-04-15");
    expect(declarationDueDate(r, 2026, 12, "cnps")).toBe("2027-01-15");
  });
});
