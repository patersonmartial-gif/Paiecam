import writeXlsxFile from "write-excel-file/node";
import type { DeclarationTotals } from "@paiecam/paie-engine";
import { spreadsheetSafe } from "@paiecam/security";

/** Données communes aux états d'un mois (identités en clair : ce sont des documents officiels). */
export interface DeclarationSheetData {
  employer: { legalName: string; niu: string; cnpsEmployerNumber: string; commune: string };
  period: { year: number; month: number };
  totals: DeclarationTotals;
  employees: Record<
    string,
    {
      matricule: string;
      lastName: string;
      firstNames: string;
      cnpsNumber: string | null;
      taxableGross: number;
    }
  >;
  /** Pour le journal : lignes de chaque bulletin (code, libellé, montant). */
  journal: Record<string, { code: string; label: string; amount: number }[]>;
}

type Cell = {
  value: string | number;
  type: StringConstructor | NumberConstructor;
  fontWeight?: "bold";
  format?: string;
};
const t = (v: string, bold = false): Cell => ({
  value: spreadsheetSafe(v),
  type: String,
  ...(bold ? { fontWeight: "bold" as const } : {}),
});
const n = (v: number, bold = false): Cell => ({
  value: v,
  type: Number,
  format: "#,##0",
  ...(bold ? { fontWeight: "bold" as const } : {}),
});
const pad = (x: number) => String(x).padStart(2, "0");
const periodLabel = (d: DeclarationSheetData) => `${pad(d.period.month)}/${d.period.year}`;

function header(d: DeclarationSheetData, title: string): Cell[][] {
  return [
    [t(title, true)],
    [
      t(
        `${d.employer.legalName} — NIU ${d.employer.niu} — N° employeur CNPS ${d.employer.cnpsEmployerNumber}`,
      ),
    ],
    [t(`Période : ${periodLabel(d)}`)],
    [],
  ];
}

const sorted = (d: DeclarationSheetData) =>
  [...d.totals.employees].sort((a, b) =>
    (d.employees[a.employeeId]?.matricule ?? "").localeCompare(
      d.employees[b.employeeId]?.matricule ?? "",
    ),
  );
const who = (d: DeclarationSheetData, id: string) =>
  d.employees[id] ?? {
    matricule: "?",
    lastName: "?",
    firstNames: "",
    cnpsNumber: null,
    taxableGross: 0,
  };

const write = (rows: Cell[][], sheet: string, widths: number[]) =>
  writeXlsxFile(rows as never, { sheet, columns: widths.map((width) => ({ width })) }).toBuffer();

/** Toutes les échéances de prêts et avances (« item.loan:<id> ») tiennent dans une seule colonne. */
const LOANS_COLUMN = { code: "item.loans", label: "Prêts et avances" };
const journalLine = (l: { code: string; label: string; amount: number }) =>
  l.code.startsWith("item.loan:") ? { ...LOANS_COLUMN, amount: l.amount } : l;

/** Journal de paie : une ligne par salarié, une colonne par rubrique, totaux. */
export function buildPayrollJournal(d: DeclarationSheetData): Promise<Buffer> {
  const columns: { code: string; label: string }[] = [];
  const journal = Object.fromEntries(
    Object.entries(d.journal).map(([id, lines]) => [id, lines.map(journalLine)]),
  );
  for (const lines of Object.values(journal)) {
    for (const l of lines)
      if (!columns.some((c) => c.code === l.code)) columns.push({ code: l.code, label: l.label });
  }
  const rows: Cell[][] = [
    ...header(d, "Journal de paie"),
    [
      t("Matricule", true),
      t("Nom", true),
      t("Prénoms", true),
      ...columns.map((c) => t(c.label, true)),
      t("Brut", true),
      t("Net à payer", true),
    ],
  ];
  const totals = new Map<string, number>();
  for (const e of sorted(d)) {
    const id = who(d, e.employeeId);
    const lines = journal[e.employeeId] ?? [];
    const amounts = columns.map((c) =>
      lines.filter((l) => l.code === c.code).reduce((s, l) => s + l.amount, 0),
    );
    columns.forEach((c, i) => totals.set(c.code, (totals.get(c.code) ?? 0) + (amounts[i] ?? 0)));
    rows.push([
      t(id.matricule),
      t(id.lastName),
      t(id.firstNames),
      ...amounts.map((a) => n(a)),
      n(e.gross),
      n(e.netPay),
    ]);
  }
  rows.push([
    t("TOTAL", true),
    t(""),
    t(""),
    ...columns.map((c) => n(totals.get(c.code) ?? 0, true)),
    n(d.totals.gross, true),
    n(d.totals.netPay, true),
  ]);
  return write(rows, "Journal", [12, 18, 18, ...columns.map(() => 16), 14, 14]);
}

/** État des cotisations CNPS par salarié. */
export function buildCnpsStatement(d: DeclarationSheetData): Promise<Buffer> {
  const rows: Cell[][] = [
    ...header(d, "État des cotisations CNPS"),
    [
      t("Matricule", true),
      t("Nom et prénoms", true),
      t("N° CNPS", true),
      t("Salaire brut", true),
      t("Assiette plafonnée", true),
      t("Pension salariale", true),
      t("Pension patronale", true),
      t("Prestations familiales", true),
      t("Accidents du travail", true),
      t("Total", true),
    ],
  ];
  for (const e of sorted(d)) {
    const id = who(d, e.employeeId);
    rows.push([
      t(id.matricule),
      t(`${id.lastName} ${id.firstNames}`),
      t(id.cnpsNumber ?? "NON RENSEIGNÉ"),
      n(e.gross),
      n(e.cnpsCappedBase),
      n(e.cnps.pensionEmployee),
      n(e.cnps.pensionEmployer),
      n(e.cnps.family),
      n(e.cnps.workAccident),
      n(e.cnps.total),
    ]);
  }
  const c = d.totals.cnps;
  rows.push([
    t("TOTAL", true),
    t(`${d.totals.headcount} salarié(s)`),
    t(""),
    n(d.totals.gross, true),
    n(d.totals.cnpsCappedBase, true),
    n(c.pensionEmployee, true),
    n(c.pensionEmployer, true),
    n(c.family, true),
    n(c.workAccident, true),
    n(c.total, true),
  ]);
  return write(rows, "CNPS", [12, 28, 16, 14, 16, 14, 14, 16, 16, 14]);
}

/** Récapitulatif DGI : total par impôt, puis détail par salarié. */
export function buildDgiSummary(d: DeclarationSheetData): Promise<Buffer> {
  const g = d.totals.dgi;
  const rows: Cell[][] = [
    ...header(d, "Récapitulatif des retenues et taxes sur salaires (DGI)"),
    [t("Impôt ou taxe", true), t("Montant (FCFA)", true)],
    [t("IRPP"), n(g.irpp)],
    [t("Centimes additionnels communaux (CAC)"), n(g.cac)],
    [t("Crédit foncier — part salariale"), n(g.cfcEmployee)],
    [t("Crédit foncier — part patronale"), n(g.cfcEmployer)],
    [t("Fonds national de l'emploi (FNE)"), n(g.fne)],
    [t("Redevance audiovisuelle (RAV)"), n(g.rav)],
    [t(`Taxe de développement local (TDL) — commune : ${d.employer.commune}`), n(g.tdl)],
    [t("TOTAL À REVERSER", true), n(g.total, true)],
    [],
    [
      t("Matricule", true),
      t("Nom et prénoms", true),
      t("Brut imposable", true),
      t("IRPP", true),
      t("CAC", true),
      t("CFC sal.", true),
      t("CFC pat.", true),
      t("FNE", true),
      t("RAV", true),
      t("TDL", true),
    ],
  ];
  for (const e of sorted(d)) {
    const id = who(d, e.employeeId);
    rows.push([
      t(id.matricule),
      t(`${id.lastName} ${id.firstNames}`),
      n(id.taxableGross),
      n(e.dgi.irpp),
      n(e.dgi.cac),
      n(e.dgi.cfcEmployee),
      n(e.dgi.cfcEmployer),
      n(e.dgi.fne),
      n(e.dgi.rav),
      n(e.dgi.tdl),
    ]);
  }
  return write(rows, "DGI", [44, 28, 14, 12, 10, 10, 10, 10, 10, 10]);
}

/**
 * DIPE — FORMAT PROVISOIRE. Le format officiel (colonnes, ordre, canal de dépôt) doit être confirmé
 * par l'expert-comptable ; cette fonction est le seul point à adapter.
 */
export function buildDipe(d: DeclarationSheetData): Promise<Buffer> {
  const rows: Cell[][] = [
    [t("DIPE — FORMAT PROVISOIRE, À VALIDER PAR L'EXPERT-COMPTABLE AVANT TOUT DÉPÔT", true)],
    ...header(d, "Déclaration des salaires, impôts et cotisations").slice(1),
    [
      t("NIU employeur", true),
      t("N° employeur CNPS", true),
      t("Période", true),
      t("Matricule", true),
      t("Nom", true),
      t("Prénoms", true),
      t("N° CNPS", true),
      t("Salaire brut", true),
      t("Salaire taxable", true),
      t("Assiette CNPS plafonnée", true),
      t("CNPS salariale", true),
      t("IRPP", true),
      t("CAC", true),
      t("CFC salariale", true),
      t("RAV", true),
      t("TDL", true),
    ],
  ];
  for (const e of sorted(d)) {
    const id = who(d, e.employeeId);
    rows.push([
      t(d.employer.niu),
      t(d.employer.cnpsEmployerNumber),
      t(periodLabel(d)),
      t(id.matricule),
      t(id.lastName),
      t(id.firstNames),
      t(id.cnpsNumber ?? ""),
      n(e.gross),
      n(id.taxableGross),
      n(e.cnpsCappedBase),
      n(e.cnps.pensionEmployee),
      n(e.dgi.irpp),
      n(e.dgi.cac),
      n(e.dgi.cfcEmployee),
      n(e.dgi.rav),
      n(e.dgi.tdl),
    ]);
  }
  return write(rows, "DIPE", [16, 16, 9, 12, 18, 18, 14, 13, 13, 16, 13, 11, 9, 12, 9, 9]);
}
