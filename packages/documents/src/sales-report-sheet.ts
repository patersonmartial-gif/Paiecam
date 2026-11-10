import writeXlsxFile from "write-excel-file/node";
import { spreadsheetSafe } from "@paiecam/security";

export interface SalesReportData {
  issuerName: string;
  from: string;
  to: string;
  invoiceCount: number;
  creditNoteCount: number;
  totalHt: number;
  totalTax: number;
  totalTtc: number;
  byMean: Record<string, number>;
  items: {
    code: string;
    label: string;
    kind: string;
    quantity: number;
    ttc: number;
    ht: number;
    cost: number;
    margin: number | null;
  }[];
  medicineMargin: number;
}

type Cell = {
  value: string | number;
  type: StringConstructor | NumberConstructor;
  fontWeight?: "bold";
};
const t = (v: string, bold = false): Cell => ({
  value: spreadsheetSafe(v),
  type: String,
  ...(bold ? { fontWeight: "bold" as const } : {}),
});
const n = (v: number, bold = false): Cell => ({
  value: v,
  type: Number,
  ...(bold ? { fontWeight: "bold" as const } : {}),
});
const MEANS: Record<string, string> = {
  cash: "Espèces",
  orange_money: "Orange Money",
  mtn_momo: "MTN Mobile Money",
};

/** Rapport des ventes d'une période (factures moins avoirs), pour le comptable. */
export function buildSalesReport(d: SalesReportData): Promise<Buffer> {
  const rows: Cell[][] = [
    [t(`Rapport des ventes — ${d.issuerName}`, true)],
    [t(`Du ${d.from} au ${d.to} (factures moins avoirs)`)],
    [],
    [t("Factures", true), n(d.invoiceCount)],
    [t("Avoirs", true), n(d.creditNoteCount)],
    [t("Total HT", true), n(d.totalHt)],
    [t("TVA", true), n(d.totalTax)],
    [t("Total TTC", true), n(d.totalTtc)],
    ...Object.entries(d.byMean).map(([m, v]) => [t(MEANS[m] ?? m), n(v)]),
    [t("Marge brute médicaments (HT − coût d'achat)", true), n(d.medicineMargin)],
    [],
    [
      t("Code", true),
      t("Désignation", true),
      t("Nature", true),
      t("Quantité", true),
      t("CA TTC", true),
      t("CA HT", true),
      t("Coût d'achat", true),
      t("Marge", true),
    ],
    ...d.items.map((i) => [
      t(i.code),
      t(i.label),
      t(i.kind === "medicine" ? "Médicament" : "Prestation"),
      n(i.quantity),
      n(i.ttc),
      n(i.ht),
      n(i.cost),
      i.margin === null ? t("") : n(i.margin),
    ]),
  ];
  return writeXlsxFile(rows as never, {
    sheet: "Ventes",
    columns: [14, 40, 14, 10, 14, 14, 14, 14].map((width) => ({ width })),
  }).toBuffer();
}
