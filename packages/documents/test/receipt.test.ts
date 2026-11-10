import { describe, expect, it } from "vitest";
import { PDFParse } from "pdf-parse";
import { renderReceiptPdf, type ReceiptPdfData } from "../src";

const base: ReceiptPdfData = {
  issuer: { legalName: "Clinique Fictive", niu: "M000000000001X", commune: "Douala 5e" },
  number: "F2026-000042",
  kind: "invoice",
  issuedAt: new Date("2026-11-10T09:30:00Z"),
  patientName: "Patient Fictif",
  paymentMean: "orange_money",
  paymentReference: "OM2611.0042",
  lines: [
    { label: "Consultation générale", quantity: 1, unitPriceTtc: 5000, totalTtc: 5000, lots: [] },
    {
      label: "Paracétamol 500 mg",
      quantity: 3,
      unitPriceTtc: 1500,
      totalTtc: 4500,
      lots: [{ lotNumber: "P-2031", expiryDate: "2031-01-31" }],
    },
  ],
  taxes: [
    { category: "standard", rate: 1925, baseHt: 3774, tax: 726 },
    { category: "exempt", rate: 0, baseHt: 5000, tax: 0 },
  ],
  totalHt: 8774,
  totalTax: 726,
  totalTtc: 9500,
  draftTax: true,
  verification: {
    code: "ABCD-EFGH-JKLM-NPQR",
    url: "http://127.0.0.1:3000/recu/ABCD-EFGH-JKLM-NPQR",
  },
};

async function text(pdf: Buffer) {
  const p = new PDFParse({ data: new Uint8Array(pdf) });
  try {
    return (await p.getText()).text.replace(/\s+/g, " ");
  } finally {
    await p.destroy();
  }
}

describe("reçu PDF", () => {
  it("facture : établissement, numéro, lignes, lots, TVA, paiement, vérification, mention pilote", async () => {
    const t = await text(await renderReceiptPdf(base));
    for (const expected of [
      "Clinique Fictive",
      "FACTURE — REÇU",
      "N° F2026-000042",
      "10/11/2026 10:30",
      "Patient : Patient Fictif",
      "Lot P-2031 (pér. 2031-01-31)",
      "TVA 19,25 % — base HT 3 774",
      "Exonéré de TVA",
      "Payé 9 500 FCFA",
      "Orange Money · réf. OM2611.0042",
      "ABCD-EFGH-JKLM-NPQR",
      "non encore validé",
    ])
      expect(t, expected).toContain(expected);
  });

  it("avoir : titre, facture annulée, montant remboursé ; sans patient ni mention si TVA validée", async () => {
    const t = await text(
      await renderReceiptPdf({
        ...base,
        kind: "credit_note",
        number: "A2026-000001",
        credited: "F2026-000042",
        patientName: null,
        paymentMean: "cash",
        paymentReference: null,
        totalHt: -8774,
        totalTax: -726,
        totalTtc: -9500,
        draftTax: false,
      }),
    );
    expect(t).toContain("AVOIR");
    expect(t).toContain("Annule la facture n° F2026-000042");
    expect(t).toContain("Remboursé -9 500 FCFA");
    expect(t).toContain("Espèces");
    expect(t).not.toContain("Patient");
    expect(t).not.toContain("non encore validé");
  });
});
