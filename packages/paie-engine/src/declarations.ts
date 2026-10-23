import type { Fcfa } from "./money";

/** Ligne de bulletin telle que conservée en base (seuls code et montant comptent ici). */
export interface DeclaredLine {
  code: string;
  amount: Fcfa;
  base?: Fcfa | null;
}

export interface DeclaredPayslip {
  employeeId: string;
  gross: Fcfa;
  netPay: Fcfa;
  employerCost: Fcfa;
  lines: readonly DeclaredLine[];
}

/** Montants d'un salarié pour les états déclaratifs. */
export interface EmployeeDeclaration {
  employeeId: string;
  gross: Fcfa;
  /** Assiette CNPS plafonnée (pension). */
  cnpsCappedBase: Fcfa;
  cnps: {
    pensionEmployee: Fcfa;
    pensionEmployer: Fcfa;
    family: Fcfa;
    workAccident: Fcfa;
    total: Fcfa;
  };
  dgi: {
    irpp: Fcfa;
    cac: Fcfa;
    cfcEmployee: Fcfa;
    cfcEmployer: Fcfa;
    fne: Fcfa;
    rav: Fcfa;
    tdl: Fcfa;
    total: Fcfa;
  };
  netPay: Fcfa;
}

export interface DeclarationTotals {
  headcount: number;
  gross: Fcfa;
  cnpsCappedBase: Fcfa;
  cnps: EmployeeDeclaration["cnps"];
  dgi: EmployeeDeclaration["dgi"];
  netPay: Fcfa;
  employerCost: Fcfa;
  employees: EmployeeDeclaration[];
}

const sumCode = (lines: readonly DeclaredLine[], code: string) =>
  lines.filter((l) => l.code === code).reduce((s, l) => s + l.amount, 0);

/**
 * Totaux à déclarer pour un mois, à partir des bulletins validés. Fonction pure : chaque total
 * est exactement la somme des lignes des bulletins (aucun recalcul, aucun taux).
 */
export function aggregateDeclarations(payslips: readonly DeclaredPayslip[]): DeclarationTotals {
  const employees: EmployeeDeclaration[] = payslips.map((p) => {
    const cnps = {
      pensionEmployee: sumCode(p.lines, "cnps.pension.employee"),
      pensionEmployer: sumCode(p.lines, "cnps.pension.employer"),
      family: sumCode(p.lines, "cnps.family"),
      workAccident: sumCode(p.lines, "cnps.work_accident"),
      total: 0,
    };
    cnps.total = cnps.pensionEmployee + cnps.pensionEmployer + cnps.family + cnps.workAccident;
    const dgi = {
      irpp: sumCode(p.lines, "irpp"),
      cac: sumCode(p.lines, "cac"),
      cfcEmployee: sumCode(p.lines, "cfc.employee"),
      cfcEmployer: sumCode(p.lines, "cfc.employer"),
      fne: sumCode(p.lines, "fne"),
      rav: sumCode(p.lines, "rav"),
      tdl: sumCode(p.lines, "tdl"),
      total: 0,
    };
    dgi.total =
      dgi.irpp + dgi.cac + dgi.cfcEmployee + dgi.cfcEmployer + dgi.fne + dgi.rav + dgi.tdl;
    const pensionLine = p.lines.find((l) => l.code === "cnps.pension.employee");
    return {
      employeeId: p.employeeId,
      gross: p.gross,
      cnpsCappedBase: pensionLine?.base ?? 0,
      cnps,
      dgi,
      netPay: p.netPay,
    };
  });

  const total = <K extends "cnps" | "dgi">(group: K, key: keyof EmployeeDeclaration[K]) =>
    employees.reduce((s, e) => s + (e[group][key] as number), 0);

  return {
    headcount: employees.length,
    gross: employees.reduce((s, e) => s + e.gross, 0),
    cnpsCappedBase: employees.reduce((s, e) => s + e.cnpsCappedBase, 0),
    cnps: {
      pensionEmployee: total("cnps", "pensionEmployee"),
      pensionEmployer: total("cnps", "pensionEmployer"),
      family: total("cnps", "family"),
      workAccident: total("cnps", "workAccident"),
      total: total("cnps", "total"),
    },
    dgi: {
      irpp: total("dgi", "irpp"),
      cac: total("dgi", "cac"),
      cfcEmployee: total("dgi", "cfcEmployee"),
      cfcEmployer: total("dgi", "cfcEmployer"),
      fne: total("dgi", "fne"),
      rav: total("dgi", "rav"),
      tdl: total("dgi", "tdl"),
      total: total("dgi", "total"),
    },
    netPay: employees.reduce((s, e) => s + e.netPay, 0),
    employerCost: payslips.reduce((s, p) => s + p.employerCost, 0),
    employees,
  };
}

/** Date limite (ISO) de la déclaration `kind` pour la paie du mois `month` de `year`. */
export function declarationDueDate(
  rule: { dayOfFollowingMonth: { cnps: number; dgi: number } },
  year: number,
  month: number,
  kind: "cnps" | "dgi",
): string {
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  const day = rule.dayOfFollowingMonth[kind];
  return `${next.y}-${String(next.m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
