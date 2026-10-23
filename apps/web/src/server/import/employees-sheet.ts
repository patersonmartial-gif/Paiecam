import writeXlsxFile from "write-excel-file/node";
import { spreadsheetSafe } from "@paiecam/security";
import type { EmployeeInput } from "@/lib/employee-schema";

type Key = keyof EmployeeInput;

/** Colonnes du modèle, dans l'ordre. L'en-tête sert aussi à reconnaître les colonnes à l'import. */
export const COLUMNS: { key: Key; header: string; example: string; width: number }[] = [
  { key: "matricule", header: "Matricule", example: "E-001", width: 12 },
  { key: "lastName", header: "Nom", example: "FICTIF", width: 18 },
  { key: "firstNames", header: "Prénoms", example: "Jean", width: 18 },
  { key: "birthDate", header: "Date de naissance", example: "01/05/1990", width: 16 },
  { key: "cnpsNumber", header: "N° CNPS", example: "", width: 14 },
  { key: "hireDate", header: "Date d'embauche", example: "15/01/2024", width: 16 },
  { key: "contractType", header: "Type de contrat", example: "CDI", width: 14 },
  { key: "endDate", header: "Date de fin", example: "", width: 14 },
  { key: "jobTitle", header: "Poste", example: "Vendeur", width: 18 },
  { key: "category", header: "Catégorie", example: "4", width: 10 },
  { key: "echelon", header: "Échelon", example: "B", width: 10 },
  { key: "baseSalary", header: "Salaire de base", example: "185000", width: 14 },
  { key: "maritalStatus", header: "Situation familiale", example: "Marié(e)", width: 18 },
  { key: "childrenCount", header: "Enfants à charge", example: "2", width: 14 },
  { key: "paymentMethod", header: "Mode de paiement", example: "Mobile money", width: 16 },
];

export const MAX_ROWS = 500;

const fold = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\(e\)|[^a-z0-9]/g, "");

/** Libellés acceptés pour les listes fermées (FR et EN), comparés sans accents ni casse. */
const ENUMS: Partial<Record<Key, Record<string, string>>> = {
  contractType: { cdi: "cdi", cdd: "cdd" },
  maritalStatus: {
    celibataire: "single",
    single: "single",
    marie: "married",
    mariee: "married",
    married: "married",
    divorce: "divorced",
    divorcee: "divorced",
    divorced: "divorced",
    veuf: "widowed",
    veuve: "widowed",
    widowed: "widowed",
  },
  paymentMethod: {
    virement: "bank_transfer",
    virementbancaire: "bank_transfer",
    banktransfer: "bank_transfer",
    mobilemoney: "mobile_money",
    momo: "mobile_money",
    orangemoney: "mobile_money",
    especes: "cash",
    cash: "cash",
  },
};

const DATE_KEYS = new Set<Key>(["birthDate", "hireDate", "endDate"]);

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Date Excel (objet Date), « JJ/MM/AAAA » ou « AAAA-MM-JJ » → « AAAA-MM-JJ ». */
function toIsoDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  }
  const s = String(value ?? "").trim();
  const fr = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (fr) return `${fr[3]}-${pad(Number(fr[2]))}-${pad(Number(fr[1]))}`;
  return s;
}

export type ParsedRow = { line: number; data: Record<Key, string> };
export type SheetParseResult =
  | { ok: true; rows: ParsedRow[] }
  | { ok: false; reason: "missing_columns"; missing: string[] }
  | { ok: false; reason: "no_rows" | "too_many_rows" };

/** Convertit la feuille lue en lignes brutes (chaînes), prêtes pour la validation Zod. */
export function parseEmployeeSheet(sheet: unknown[][]): SheetParseResult {
  const [header, ...body] = sheet;
  const index = new Map((header ?? []).map((h, i) => [fold(String(h ?? "")), i]));
  const missing = COLUMNS.filter((c) => !index.has(fold(c.header))).map((c) => c.header);
  if (missing.length > 0) return { ok: false, reason: "missing_columns", missing };

  const rows: ParsedRow[] = [];
  body.forEach((cells, i) => {
    if (cells.every((c) => c === null || c === undefined || String(c).trim() === "")) return;
    const data = {} as Record<Key, string>;
    for (const col of COLUMNS) {
      const raw = cells[index.get(fold(col.header)) ?? -1];
      let value = DATE_KEYS.has(col.key) ? toIsoDate(raw) : String(raw ?? "").trim();
      const choices = ENUMS[col.key];
      if (choices && value) value = choices[fold(value)] ?? value;
      data[col.key] = value;
    }
    rows.push({ line: i + 2, data });
  });
  if (rows.length === 0) return { ok: false, reason: "no_rows" };
  if (rows.length > MAX_ROWS) return { ok: false, reason: "too_many_rows" };
  return { ok: true, rows };
}

/** Modèle à remplir : en-têtes + une ligne d'exemple fictive. Toutes les cellules sont du texte. */
export async function buildEmployeeTemplate(): Promise<Buffer> {
  const text = (value: string, bold = false) => ({
    value: spreadsheetSafe(value),
    type: String,
    ...(bold ? { fontWeight: "bold" as const } : {}),
  });
  return writeXlsxFile(
    [COLUMNS.map((c) => text(c.header, true)), COLUMNS.map((c) => text(c.example))],
    { sheet: "Salariés", columns: COLUMNS.map((c) => ({ width: c.width })) },
  ).toBuffer();
}
