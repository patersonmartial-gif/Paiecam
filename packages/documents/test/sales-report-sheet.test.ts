import { describe, expect, it } from "vitest";
import { readSheet } from "read-excel-file/node";
import { buildSalesReport } from "../src";

describe("rapport des ventes (Excel)", () => {
  it("totaux, lignes par article, cellules neutralisées contre les formules", async () => {
    const buf = await buildSalesReport({
      issuerName: '=HYPERLINK("http://pirate")',
      from: "2026-11-01",
      to: "2026-11-10",
      invoiceCount: 2,
      creditNoteCount: 1,
      totalHt: 8774,
      totalTax: 726,
      totalTtc: 9500,
      byMean: { cash: 9500, orange_money: 0, mtn_momo: 0 },
      items: [
        {
          code: "PARA",
          label: "Paracétamol",
          kind: "medicine",
          quantity: 3,
          ttc: 4500,
          ht: 3774,
          cost: 2000,
          margin: 1774,
        },
        {
          code: "CONS",
          label: "@cmd",
          kind: "service",
          quantity: 1,
          ttc: 5000,
          ht: 5000,
          cost: 0,
          margin: null,
        },
      ],
      medicineMargin: 1774,
    });
    const rows = (await readSheet(buf)).map((r) => r.map((c) => (c === null ? "" : c)));
    expect(rows.find((r) => r[0] === "Total TTC")?.[1]).toBe(9500);
    expect(rows.find((r) => r[0] === "PARA")).toEqual([
      "PARA",
      "Paracétamol",
      "Médicament",
      3,
      4500,
      3774,
      2000,
      1774,
    ]);
    for (const row of rows)
      for (const c of row) if (typeof c === "string") expect(c).not.toMatch(/^[=+\-@]/);
  });
});
