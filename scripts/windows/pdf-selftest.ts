// Auto-contrôle de l'empaquetage : produit un bulletin PDF fictif avec le code regroupé
// (polices standard comprises). Exécuté par bundle.mjs juste après le regroupement.
import { renderPayslipPdf } from "@paiecam/documents";

const pdf = await renderPayslipPdf(
  {
    language: "fr",
    employer: {
      legalName: "Entreprise fictive",
      niu: "M000000000000X",
      cnpsEmployerNumber: "000-000000-X",
      commune: "Douala 1er",
    },
    employee: {
      lastName: "FICTIF",
      firstNames: "Test",
      matricule: "T-1",
      jobTitle: "Agent",
      category: "1",
      echelon: "A",
      hireDate: "2024-01-15",
      contractType: "cdi",
      cnpsNumber: null,
    },
    period: { year: 2026, month: 1 },
    lines: [
      {
        code: "base",
        label: "Salaire de base",
        section: "earning",
        base: null,
        rate: null,
        amount: 100000,
      },
    ],
    totals: {
      gross: 100000,
      employeeContributions: 0,
      deductions: 0,
      netPay: 100000,
      employerCost: 100000,
    },
    ytd: { gross: 100000, irpp: 0, netPay: 100000 },
  },
  {
    verification: {
      code: "AAAA-BBBB-CCCC-DDDD",
      url: "http://localhost:3000/verifier/AAAA-BBBB-CCCC-DDDD",
    },
  },
);
if (pdf.subarray(0, 5).toString() !== "%PDF-") throw new Error("PDF invalide");
console.warn(`auto-contrôle PDF : ${pdf.length} octets`);
