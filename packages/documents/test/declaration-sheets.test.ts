import { describe, expect, it } from "vitest";
import { readSheet } from "read-excel-file/node";
import { aggregateDeclarations } from "@paiecam/paie-engine";
import {
  buildCnpsStatement,
  buildDgiSummary,
  buildDipe,
  buildPayrollJournal,
  type DeclarationSheetData,
} from "../src";

const lines = (base: number, irpp: number) => [
  { code: "base", label: "Salaire de base", amount: base },
  {
    code: "cnps.pension.employee",
    label: "CNPS pension (sal.)",
    amount: Math.round(base * 0.042),
    base,
  },
  {
    code: "cnps.pension.employer",
    label: "CNPS pension (pat.)",
    amount: Math.round(base * 0.042),
    base,
  },
  { code: "cnps.family", label: "PF", amount: Math.round(base * 0.07) },
  { code: "cnps.work_accident", label: "AT", amount: Math.round(base * 0.0175) },
  { code: "irpp", label: "IRPP", amount: irpp },
  { code: "cac", label: "CAC", amount: Math.floor(irpp / 10) },
  { code: "rav", label: "RAV", amount: 4_550 },
  { code: "tdl", label: "TDL", amount: 2_250 },
];
const slips = [
  {
    employeeId: "b",
    gross: 400_000,
    netPay: 345_015,
    employerCost: 461_800,
    lines: lines(400_000, 24_896),
  },
  {
    employeeId: "a",
    gross: 300_000,
    netPay: 260_000,
    employerCost: 350_000,
    lines: lines(300_000, 12_000),
  },
];
const data: DeclarationSheetData = {
  employer: {
    legalName: "Société =Fictive",
    niu: "M000000000001X",
    cnpsEmployerNumber: "000-0000000-A",
    commune: "Douala 3e",
  },
  period: { year: 2026, month: 3 },
  totals: aggregateDeclarations(slips),
  employees: {
    a: {
      matricule: "E-001",
      lastName: "AWA",
      firstNames: "Marie",
      cnpsNumber: "111222333",
      taxableGross: 300_000,
    },
    b: {
      matricule: "E-002",
      lastName: "=CMD|' /C calc'!A0",
      firstNames: "Paul",
      cnpsNumber: null,
      taxableGross: 400_000,
    },
  },
  journal: Object.fromEntries(
    slips.map((s) => [
      s.employeeId,
      s.lines.map(({ code, label, amount }) => ({ code, label, amount })),
    ]),
  ),
};
const cellsOf = async (buf: Buffer) =>
  (await readSheet(buf)).map((r) => r.map((c) => (c === null ? "" : c)));

describe("états déclaratifs", () => {
  it("journal : une ligne par salarié triée par matricule, totaux égaux aux sommes", async () => {
    const rows = await cellsOf(await buildPayrollJournal(data));
    const head = rows[4] ?? [];
    expect(head.slice(0, 4)).toEqual(["Matricule", "Nom", "Prénoms", "Salaire de base"]);
    expect(rows[5]?.[0]).toBe("E-001");
    expect(rows[6]?.[0]).toBe("E-002");
    const total = rows[7] ?? [];
    expect(total[0]).toBe("TOTAL");
    expect(total[head.indexOf("IRPP")]).toBe(36_896);
    expect(total.at(-1)).toBe(605_015);
  });

  it("journal : toutes les échéances de prêts dans une seule colonne « Prêts et avances »", async () => {
    const [first] = Object.keys(data.journal);
    const withLoans = {
      ...data,
      journal: {
        ...data.journal,
        [first ?? ""]: [
          ...(data.journal[first ?? ""] ?? []),
          {
            code: "item.loan:0190a000-0000-7000-8000-000000000001",
            label: "Prêt — échéance 1/3",
            amount: 10_000,
          },
          {
            code: "item.loan:0190a000-0000-7000-8000-000000000002",
            label: "Avance — échéance 1/1",
            amount: 5_000,
          },
        ],
      },
    };
    const rows = await cellsOf(await buildPayrollJournal(withLoans));
    const head = rows[4] ?? [];
    expect(head.filter((h) => String(h).includes("échéance"))).toEqual([]);
    const col = head.indexOf("Prêts et avances");
    expect(col).toBeGreaterThan(0);
    const matricule = data.employees[first ?? ""]?.matricule;
    expect(rows.find((r) => r[0] === matricule)?.[col]).toBe(15_000);
    expect(rows.find((r) => r[0] === "TOTAL")?.[col]).toBe(15_000);
  });

  it("état CNPS : n° CNPS, assiettes et total par branche", async () => {
    const rows = await cellsOf(await buildCnpsStatement(data));
    expect(rows[5]?.slice(0, 3)).toEqual(["E-001", "AWA Marie", "111222333"]);
    expect(rows[6]?.[2]).toBe("NON RENSEIGNÉ");
    const total = rows[7] ?? [];
    expect(total[4]).toBe(700_000);
    expect(total[9]).toBe(data.totals.cnps.total);
  });

  it("récapitulatif DGI : total à reverser = somme des taxes", async () => {
    const rows = await cellsOf(await buildDgiSummary(data));
    const totalRow = rows.find((r) => r[0] === "TOTAL À REVERSER");
    expect(totalRow?.[1]).toBe(data.totals.dgi.total);
    expect(rows.find((r) => String(r[0]).startsWith("Taxe de développement local"))?.[0]).toContain(
      "Douala 3e",
    );
  });

  it("DIPE : marquée provisoire, une ligne par salarié", async () => {
    const rows = await cellsOf(await buildDipe(data));
    expect(String(rows[0]?.[0])).toContain("FORMAT PROVISOIRE");
    const body = rows.filter((r) => r[0] === "M000000000001X");
    expect(body.map((r) => r[3])).toEqual(["E-001", "E-002"]);
    expect(body[0]?.[2]).toBe("03/2026");
  });

  it("aucune cellule ne commence par un caractère de formule", async () => {
    for (const build of [buildPayrollJournal, buildCnpsStatement, buildDgiSummary, buildDipe]) {
      for (const row of await cellsOf(await build(data))) {
        for (const c of row) if (typeof c === "string") expect(c, c).not.toMatch(/^[=+\-@]/);
      }
    }
  });
});
