import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { computeInvoice, type PayRule } from "../src";
import { loadRuleFile } from "../rules/load";

const rules: PayRule[] = loadRuleFile(
  new URL("../rules/cm-2026.draft.json", import.meta.url).pathname,
);
const date = "2026-11-10";

describe("facture (prix TTC, taxe extraite par catégorie)", () => {
  it("consultation exonérée + médicament taxé : HT + TVA = TTC au franc près", () => {
    const f = computeInvoice(
      [
        { label: "Consultation générale", quantity: 1, unitPriceTtc: 5_000, taxCategory: "exempt" },
        { label: "Paracétamol 500 mg", quantity: 2, unitPriceTtc: 1_500, taxCategory: "standard" },
      ],
      rules,
      date,
    );
    // 3 000 × 10 000 / 11 925 = 2 515,72 → 2 516 HT ; TVA 484.
    expect(f.taxes).toEqual([
      { category: "standard", rate: 1925, baseHt: 2_516, tax: 484, totalTtc: 3_000 },
      { category: "exempt", rate: 0, baseHt: 5_000, tax: 0, totalTtc: 5_000 },
    ]);
    expect(f).toMatchObject({ totalTtc: 8_000, totalHt: 7_516, totalTax: 484 });
    expect(f.lines[1]?.totalTtc).toBe(3_000);
    expect(f.ruleUsed).toMatchObject({ code: "tva", status: "draft" });
  });

  it("propriété : la somme HT + taxes vaut toujours le TTC, entiers positifs", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            quantity: fc.integer({ min: 1, max: 50 }),
            unitPriceTtc: fc.integer({ min: 0, max: 500_000 }),
            taxCategory: fc.constantFrom("standard" as const, "exempt" as const),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        (lines) => {
          const f = computeInvoice(
            lines.map((l, i) => ({ ...l, label: `Article ${i}` })),
            rules,
            date,
          );
          expect(f.totalHt + f.totalTax).toBe(f.totalTtc);
          for (const t of f.taxes) {
            expect(Number.isSafeInteger(t.tax) && t.tax >= 0).toBe(true);
            expect(t.baseHt + t.tax).toBe(t.totalTtc);
          }
        },
      ),
    );
  });

  it("garde la trace de la règle validée utilisée (identifiant et statut)", () => {
    const validated = rules.map((r) =>
      r.code === "tva" ? { ...r, id: "regle-tva-fictive", status: "validated" as const } : r,
    );
    const f = computeInvoice(
      [{ label: "Soins", quantity: 1, unitPriceTtc: 2_000, taxCategory: "exempt" }],
      validated,
      date,
    );
    expect(f.taxes.map((t) => t.category)).toEqual(["exempt"]);
    expect(f.ruleUsed).toEqual({
      id: "regle-tva-fictive",
      code: "tva",
      validFrom: "2026-01-01",
      status: "validated",
    });
  });

  it("une règle sans statut compte comme un brouillon", () => {
    const unknown: PayRule[] = rules.map((r) =>
      r.code === "tva"
        ? {
            id: r.id ?? "x",
            code: r.code,
            validFrom: r.validFrom,
            validTo: r.validTo,
            value: r.value,
          }
        : r,
    );
    const f = computeInvoice(
      [{ label: "Soins", quantity: 1, unitPriceTtc: 2_000, taxCategory: "exempt" }],
      unknown,
      date,
    );
    expect(f.ruleUsed.status).toBe("draft");
  });

  it("refuse une facture vide, une quantité ou un prix invalides", () => {
    expect(() => computeInvoice([], rules, date)).toThrow(/au moins une ligne/);
    const line = { label: "X", quantity: 1, unitPriceTtc: 100, taxCategory: "exempt" as const };
    expect(() => computeInvoice([{ ...line, quantity: 0 }], rules, date)).toThrow(/quantité/);
    expect(() => computeInvoice([{ ...line, quantity: 1.5 }], rules, date)).toThrow(/quantité/);
    expect(() => computeInvoice([{ ...line, unitPriceTtc: -1 }], rules, date)).toThrow(/négatif/);
    expect(() => computeInvoice([{ ...line, unitPriceTtc: 0.5 }], rules, date)).toThrow();
  });
});
