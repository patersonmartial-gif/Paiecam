export type Lang = "fr" | "en";

const T = {
  fr: {
    title: "Bulletin de paie",
    period: "Période",
    employer: "Employeur",
    employee: "Salarié",
    niu: "NIU",
    cnpsEmployer: "N° employeur CNPS",
    commune: "Commune",
    matricule: "Matricule",
    job: "Emploi",
    category: "Catégorie / échelon",
    hireDate: "Date d'embauche",
    contract: "Contrat",
    cnpsNumber: "N° CNPS",
    item: "Rubrique",
    base: "Base",
    rate: "Taux",
    amount: "Montant",
    sections: {
      earning: "Gains",
      allowance: "Indemnités hors brut",
      employee_contribution: "Retenues salariales",
      deduction: "Retenues sur net",
      employer_contribution: "Charges patronales (pour information)",
    },
    gross: "Salaire brut",
    totalDeductions: "Total des retenues",
    netPay: "NET À PAYER",
    employerCost: "Coût total employeur",
    ytd: "Cumuls de l'année",
    ytdGross: "Brut cumulé",
    ytdIrpp: "IRPP cumulé",
    ytdNet: "Net cumulé",
    verify: "Vérifier l'authenticité de ce bulletin",
    code: "Code",
    keep: "À conserver sans limitation de durée.",
    notProvided: "non renseigné",
    contracts: { cdi: "CDI", cdd: "CDD" } as Record<string, string>,
  },
  en: {
    title: "Payslip",
    period: "Period",
    employer: "Employer",
    employee: "Employee",
    niu: "Taxpayer no. (NIU)",
    cnpsEmployer: "CNPS employer no.",
    commune: "Municipality",
    matricule: "Employee ID",
    job: "Position",
    category: "Category / step",
    hireDate: "Hire date",
    contract: "Contract",
    cnpsNumber: "CNPS no.",
    item: "Item",
    base: "Base",
    rate: "Rate",
    amount: "Amount",
    sections: {
      earning: "Earnings",
      allowance: "Non-gross allowances",
      employee_contribution: "Employee deductions",
      deduction: "Deductions from net",
      employer_contribution: "Employer contributions (for information)",
    },
    gross: "Gross salary",
    totalDeductions: "Total deductions",
    netPay: "NET PAY",
    employerCost: "Total employer cost",
    ytd: "Year to date",
    ytdGross: "Gross YTD",
    ytdIrpp: "IRPP YTD",
    ytdNet: "Net YTD",
    verify: "Verify this payslip's authenticity",
    code: "Code",
    keep: "Keep indefinitely.",
    notProvided: "not provided",
    contracts: { cdi: "Permanent", cdd: "Fixed-term" } as Record<string, string>,
  },
} as const;

export const labels = (lang: Lang) => T[lang];

/** Libellés anglais des lignes calculées par le moteur (les rubriques ont leur propre libellé EN). */
const LINE_EN: Record<string, string> = {
  base: "Base salary",
  "cnps.pension.employee": "CNPS pension (employee)",
  "cnps.pension.employer": "CNPS pension (employer)",
  "cnps.family": "CNPS family benefits",
  "cnps.work_accident": "CNPS work accidents",
  irpp: "Income tax (IRPP)",
  cac: "Municipal surtax (CAC)",
  "cfc.employee": "Housing fund CFC (employee)",
  "cfc.employer": "Housing fund CFC (employer)",
  fne: "National Employment Fund (FNE)",
  rav: "Broadcasting fee (RAV)",
  tdl: "Local development tax (TDL)",
};

export function lineLabel(
  code: string,
  frLabel: string,
  lang: Lang,
  itemLabelsEn: Record<string, string> = {},
): string {
  if (lang === "fr") return frLabel;
  if (code.startsWith("item.")) return itemLabelsEn[code.slice(5)] ?? frLabel;
  if (code.startsWith("overtime."))
    return frLabel.replace("Heures supplémentaires majorées de", "Overtime at +");
  return LINE_EN[code] ?? frLabel;
}

const MONTHS = {
  fr: [
    "janvier",
    "février",
    "mars",
    "avril",
    "mai",
    "juin",
    "juillet",
    "août",
    "septembre",
    "octobre",
    "novembre",
    "décembre",
  ],
  en: [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ],
};
export const monthLabel = (lang: Lang, year: number, month: number) =>
  `${MONTHS[lang][month - 1] ?? month} ${year}`;

/** Montant avec espaces ordinaires (la police PDF standard n'a pas l'espace fine insécable). */
export const amount = (n: number) => n.toLocaleString("fr-FR").replace(/[\u202f\u00a0]/g, " ");
export const percent = (bp: number) => `${(bp / 100).toLocaleString("fr-FR")} %`;
export const isoToDisplay = (iso: string) => iso.split("-").reverse().join("/");
