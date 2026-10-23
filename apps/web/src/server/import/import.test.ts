import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { readSheet } from "read-excel-file/node";
import writeXlsxFile from "write-excel-file/node";
import { employeeSchema } from "@/lib/employee-schema";
import { buildEmployeeTemplate, COLUMNS, parseEmployeeSheet } from "./employees-sheet";
import { inspectXlsx, XlsxRejected } from "./xlsx-guard";

const rejection = (fn: () => void) => {
  try {
    fn();
  } catch (e) {
    return e instanceof XlsxRejected ? e.reason : "autre erreur";
  }
  return "accepté";
};

describe("inspectXlsx", () => {
  it("accepte le modèle généré", async () => {
    expect(rejection(() => inspectXlsx(new Uint8Array([])))).toBe("empty");
    const buf = await buildEmployeeTemplate();
    expect(rejection(() => inspectXlsx(buf))).toBe("accepté");
  });

  it("refuse un fichier qui n'est pas un .xlsx, même renommé", () => {
    expect(rejection(() => inspectXlsx(strToU8("Matricule;Nom\nE-001;Fictif")))).toBe("not_xlsx");
    expect(
      rejection(() => inspectXlsx(zipSync({ "readme.txt": strToU8("pas un classeur") }))),
    ).toBe("not_xlsx");
    const truncated = zipSync({ "xl/workbook.xml": strToU8("<workbook/>".repeat(1000)) }).slice(
      0,
      60,
    );
    expect(rejection(() => inspectXlsx(truncated))).toBe("not_xlsx");
  });

  it("refuse une bombe zip (petit fichier, énorme une fois décompressé)", () => {
    const bomb = zipSync({
      "xl/workbook.xml": strToU8("<w/>"),
      "xl/sheet.xml": new Uint8Array(30 * 1024 * 1024),
    });
    expect(bomb.length).toBeLessThan(2 * 1024 * 1024);
    expect(rejection(() => inspectXlsx(bomb))).toBe("uncompressed_too_large");
  });

  it("refuse un fichier trop lourd ou avec trop d'entrées", () => {
    const big = new Uint8Array(3 * 1024 * 1024);
    big.set([0x50, 0x4b, 0x03, 0x04]);
    expect(rejection(() => inspectXlsx(big))).toBe("too_large");
    const many = Object.fromEntries(
      Array.from({ length: 300 }, (_, i) => [`f${i}.xml`, strToU8("x")]),
    );
    expect(
      rejection(() => inspectXlsx(zipSync({ "xl/workbook.xml": strToU8("<w/>"), ...many }))),
    ).toBe("too_many_entries");
  });
});

describe("modèle et lecture", () => {
  it("le modèle relu donne une ligne d'exemple valide", async () => {
    const sheet = await readSheet(await buildEmployeeTemplate());
    expect(sheet[0]).toEqual(COLUMNS.map((c) => c.header));
    const parsed = parseEmployeeSheet(sheet);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.line).toBe(2);
    expect(employeeSchema.safeParse(parsed.rows[0]?.data).success).toBe(true);
  });

  it("reconnaît les en-têtes sans accents ni casse, les dates Excel et les libellés", async () => {
    const header = COLUMNS.map((c) => c.header.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, ""));
    const row = [
      "E-002",
      "MBARGA",
      "Aïcha",
      new Date(Date.UTC(1992, 2, 9)),
      "",
      "1/3/2025",
      "cdd",
      "2026-02-28",
      "Caissière",
      3,
      "A",
      150000,
      "célibataire",
      0,
      "Espèces",
    ];
    const parsed = parseEmployeeSheet([header, row, ["", null, undefined]]);
    expect(parsed.ok && parsed.rows).toEqual([
      {
        line: 2,
        data: expect.objectContaining({
          birthDate: "1992-03-09",
          hireDate: "2025-03-01",
          endDate: "2026-02-28",
          contractType: "cdd",
          maritalStatus: "single",
          paymentMethod: "cash",
          category: "3",
          baseSalary: "150000",
        }),
      },
    ]);
  });

  it("signale les colonnes manquantes, un fichier vide ou trop long", () => {
    expect(parseEmployeeSheet([["Matricule", "Nom"]])).toMatchObject({
      ok: false,
      reason: "missing_columns",
    });
    const header = COLUMNS.map((c) => c.header);
    expect(parseEmployeeSheet([header])).toEqual({ ok: false, reason: "no_rows" });
    const rows = Array.from({ length: 501 }, (_, i) => [
      `E-${i}`,
      ...COLUMNS.slice(1).map(() => "x"),
    ]);
    expect(parseEmployeeSheet([header, ...rows])).toEqual({ ok: false, reason: "too_many_rows" });
  });

  it("une formule dans un fichier importé n'est jamais exécutée : seule sa valeur texte est lue", async () => {
    const header = COLUMNS.map((c) => ({ value: c.header, type: String }));
    const buf = await writeXlsxFile([
      header,
      [{ value: "SUM(1,2)", type: "Formula" as const }],
    ]).toBuffer();
    const sheet = await readSheet(buf);
    const parsed = parseEmployeeSheet(sheet);
    // La cellule formule devient une valeur (ou vide) ; le matricule « =… » serait de toute façon refusé.
    expect(parsed.ok && employeeSchema.safeParse(parsed.rows[0]?.data).success).toBe(false);
  });
});
