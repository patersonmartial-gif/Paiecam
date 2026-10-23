import { mkdtempSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PDFParse } from "pdf-parse";
import { parseKeyring } from "@paiecam/security";
import {
  createFsStorage,
  newVerificationCode,
  renderPayslipPdf,
  sha256Hex,
  type PayslipPdfData,
} from "../src";

const data: PayslipPdfData = {
  language: "fr",
  employer: {
    legalName: "Boulangerie Fictive SARL",
    niu: "M000000000001X",
    cnpsEmployerNumber: "000-0000000-A",
    commune: "Douala 3e",
  },
  employee: {
    lastName: "FICTIF",
    firstNames: "Jean",
    matricule: "E-001",
    jobTitle: "Vendeur",
    category: "4",
    echelon: "B",
    hireDate: "2024-01-15",
    contractType: "cdi",
    cnpsNumber: "198765432",
  },
  period: { year: 2026, month: 3 },
  lines: [
    {
      code: "base",
      label: "Salaire de base",
      section: "earning",
      base: 400_000,
      rate: null,
      amount: 400_000,
    },
    {
      code: "item.transport",
      label: "Indemnité de transport",
      section: "allowance",
      base: null,
      rate: null,
      amount: 15_000,
    },
    {
      code: "cnps.pension.employee",
      label: "CNPS pension vieillesse (part salariale)",
      section: "employee_contribution",
      base: 400_000,
      rate: 420,
      amount: 16_800,
    },
    {
      code: "irpp",
      label: "IRPP",
      section: "employee_contribution",
      base: 2_658_400,
      rate: null,
      amount: 24_896,
    },
    {
      code: "cnps.family",
      label: "CNPS prestations familiales",
      section: "employer_contribution",
      base: 400_000,
      rate: 700,
      amount: 28_000,
    },
  ],
  totals: {
    gross: 400_000,
    employeeContributions: 54_985,
    deductions: 0,
    netPay: 345_015,
    employerCost: 461_800,
  },
  ytd: { gross: 1_200_000, irpp: 74_688, netPay: 1_035_045 },
  itemLabelsEn: { transport: "Transport allowance" },
};

async function text(pdf: Buffer) {
  const parser = new PDFParse({ data: new Uint8Array(pdf) });
  try {
    return (await parser.getText()).text.replace(/\s+/g, " ");
  } finally {
    await parser.destroy();
  }
}

describe("renderPayslipPdf", () => {
  it("produit un PDF français avec les montants, l'employeur et le code de vérification", async () => {
    const pdf = await renderPayslipPdf(data, {
      verification: {
        code: "ABCD-EFGH-JKLM-NPQR",
        url: "https://paiecam.example/verifier/ABCD-EFGH-JKLM-NPQR",
      },
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const t = await text(pdf);
    for (const s of [
      "Bulletin de paie",
      "mars 2026",
      "Boulangerie Fictive SARL",
      "M000000000001X",
      "FICTIF Jean",
      "198765432",
      "Salaire de base",
      "400 000",
      "NET À PAYER",
      "345 015 FCFA",
      "4,2 %",
      "Cumuls de l'année",
      "1 035 045",
      "ABCD-EFGH-JKLM-NPQR",
    ]) {
      expect(t, s).toContain(s);
    }
    expect(t).not.toContain("PROVISOIRE");
  });

  it("produit un PDF anglais, avec les libellés traduits", async () => {
    const t = await text(await renderPayslipPdf({ ...data, language: "en" }));
    for (const s of [
      "Payslip",
      "March 2026",
      "Base salary",
      "Transport allowance",
      "Income tax (IRPP)",
      "NET PAY",
      "Permanent",
    ]) {
      expect(t, s).toContain(s);
    }
  });

  it("affiche le filigrane d'un aperçu provisoire", async () => {
    const t = await text(
      await renderPayslipPdf(
        { ...data, employee: { ...data.employee, cnpsNumber: null } },
        { watermark: "APERÇU — PROVISOIRE" },
      ),
    );
    expect(t).toContain("APERÇU — PROVISOIRE");
    expect(t).toContain("non renseigné");
  });
});

describe("stockage chiffré sur disque", () => {
  const ring = parseKeyring(`v1:${Buffer.alloc(32, 4).toString("base64")}`);
  const root = mkdtempSync(join(tmpdir(), "paiecam-docs-"));
  const storage = createFsStorage(root, ring);

  it("écrit chiffré, relit en clair, n'écrase jamais", async () => {
    const pdf = Buffer.from("%PDF-1.7 fictif");
    await storage.put("tenant-a/2026-03/doc.pdf", pdf);
    expect((await readFile(join(root, "tenant-a/2026-03/doc.pdf"))).includes(pdf)).toBe(false);
    expect(await storage.get("tenant-a/2026-03/doc.pdf")).toEqual(pdf);
    await expect(storage.put("tenant-a/2026-03/doc.pdf", pdf)).rejects.toThrow(/EEXIST/);
  });

  it("rotation : rechiffre avec la clé courante, sans fichier temporaire restant", async () => {
    const pdf = Buffer.from("%PDF-1.7 rotation");
    await storage.put("tenant-a/2026-04/doc.pdf", pdf);
    const k1 = `v1:${Buffer.alloc(32, 4).toString("base64")}`;
    const k2 = `v2:${Buffer.alloc(32, 5).toString("base64")}`;
    const rotated = createFsStorage(root, parseKeyring(`${k2},${k1}`));
    expect(await rotated.reencrypt("tenant-a/2026-04/doc.pdf")).toBe("rewritten");
    expect(await rotated.reencrypt("tenant-a/2026-04/doc.pdf")).toBe("current");
    expect(await createFsStorage(root, parseKeyring(k2)).get("tenant-a/2026-04/doc.pdf")).toEqual(
      pdf,
    );
    expect(readdirSync(join(root, "tenant-a/2026-04"))).toEqual(["doc.pdf"]);
    await expect(createFsStorage(root, parseKeyring(k2)).reencrypt("../x")).rejects.toThrow(
      /invalide/,
    );
  });

  it("refuse les clés qui sortent du dossier", async () => {
    for (const bad of ["../x.pdf", "/etc/passwd", "a/../../b", "A/majuscule", ""]) {
      await expect(storage.put(bad, Buffer.from("x"))).rejects.toThrow(/clé de stockage invalide/);
    }
  });
});

describe("vérification", () => {
  it("code lisible et sans ambiguïté, empreinte SHA-256", () => {
    const codes = new Set(Array.from({ length: 200 }, newVerificationCode));
    expect(codes.size).toBe(200);
    for (const c of codes) expect(c).toMatch(/^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/);
    expect(sha256Hex(Buffer.from("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
