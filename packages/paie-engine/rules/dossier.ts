/**
 * Dossier de validation pour l'expert-comptable : pnpm dossier:expert [sortie.xlsx]
 * Feuilles : Lisez-moi, Règles (à valider), Questions (à trancher), Cas de calcul (ligne par ligne).
 * Tout est recalculé depuis le référentiel brouillon et le moteur : aucune valeur recopiée à la main.
 */
import writeXlsxFile from "write-excel-file/node";
import { spreadsheetSafe } from "@paiecam/security";
import { computePayslip, type PayslipInput } from "../src";
import { loadRuleFile, type RuleFileEntry } from "./load";
import { fileURLToPath } from "node:url";

const out = process.argv[2] ?? "dossier-expert-comptable.xlsx";
const rulesPath = fileURLToPath(new URL("./cm-2026.draft.json", import.meta.url));
const rules = loadRuleFile(rulesPath);

const fr = new Intl.NumberFormat("fr-FR");
const pct = (bp: number) => `${fr.format(bp / 100)} %`;
const money = (n: number) => `${fr.format(n)} FCFA`;

type Cell = {
  value: string | number;
  type: StringConstructor | NumberConstructor;
  fontWeight?: "bold";
  wrap?: boolean;
};
const t = (v: string, bold = false): Cell => ({
  value: spreadsheetSafe(v),
  type: String,
  wrap: true,
  ...(bold ? { fontWeight: "bold" as const } : {}),
});
const n = (v: number): Cell => ({ value: v, type: Number });
const header = (...cols: string[]) => cols.map((c) => t(c, true));

/** Valeur d'une règle en clair, pour un lecteur non développeur. */
function describe(r: RuleFileEntry): string {
  const v = r.value as Record<string, unknown>;
  const brackets = (list: { from: number; to: number | null; rate?: number; amount?: number }[]) =>
    list
      .map(
        (b) =>
          `${fr.format(b.from)} à ${b.to === null ? "∞" : fr.format(b.to)} : ${b.rate !== undefined ? pct(b.rate) : money(b.amount ?? 0)}`,
      )
      .join("\n");
  switch (r.code) {
    case "cnps.pension":
      return `Salarié ${pct(v.employeeRate as number)}, employeur ${pct(v.employerRate as number)}, plafond ${money(v.monthlyCeiling as number)} par mois`;
    case "cnps.prestations_familiales": {
      const x = v.employerRateByRegime as Record<string, number>;
      return `Employeur : général ${pct(x.general ?? 0)}, agricole ${pct(x.agricole ?? 0)}, enseignement privé ${pct(x.enseignement_prive ?? 0)} ; plafond ${money(v.monthlyCeiling as number)}`;
    }
    case "cnps.accidents_travail":
      return `Taux possibles : ${(v.allowedEmployerRates as number[]).map(pct).join(", ")} (sur la totalité du salaire)`;
    case "irpp.bareme":
      return [
        "Barème annuel :",
        brackets(v.brackets as never),
        `Frais professionnels : ${pct(v.professionalExpensesRate as number)}${v.professionalExpensesMonthlyCap === null ? " sans plafond" : ` plafonnés à ${money(v.professionalExpensesMonthlyCap as number)}/mois`}`,
        `Abattement annuel : ${money(v.annualAllowance as number)}`,
        `Seuil d'exonération : ${money(v.monthlyExemptionThreshold as number)} de brut imposable mensuel`,
        `Arrondi de l'IRPP mensuel : ${v.rounding === "down" ? "au franc inférieur" : v.rounding}`,
      ].join("\n");
    case "cac":
      return `${pct(v.rateOfIrpp as number)} du montant de l'IRPP`;
    case "cfc":
      return `Salarié ${pct(v.employeeRate as number)}, employeur ${pct(v.employerRate as number)}, sur le brut imposable`;
    case "fne":
      return `Employeur ${pct(v.employerRate as number)}, sur le brut imposable`;
    case "rav":
      return `Montant mensuel selon le brut imposable :\n${brackets(v.brackets as never)}`;
    case "tdl":
      return `Montant mensuel selon le salaire de base :\n${brackets(v.brackets as never)}`;
    case "heures_sup.majorations":
      return `Diviseur horaire ${fr.format((v.monthlyHoursHundredths as number) / 100)} h ; majorations : ${Object.entries(
        v.rates as Record<string, number>,
      )
        .map(([k, r]) => `${k} = ${pct(r)}`)
        .join(", ")}`;
    case "smig":
      return `${money(v.monthlyAmount as number)} par mois (temps plein)`;
    case "retenues.plafond":
      return `Part retenable du net avant retenues, par tranche :\n${brackets(v.brackets as never)}`;
    default:
      return JSON.stringify(v);
  }
}

const march = { start: "2026-03-01", end: "2026-03-31" };
const employer = { regime: "general" as const, workAccidentRate: 175 };
const simple = (base: number, label: string): [string, PayslipInput] => [
  label,
  {
    period: march,
    employer,
    employee: { baseSalary: base, hireDate: "2024-01-15", endDate: null },
  },
];
const scenarios: [string, PayslipInput][] = [
  simple(55_000, "Salaire sous le seuil d'exonération IRPP (et sous le SMIG : avertissement)"),
  simple(62_000, "Salaire au seuil d'exonération"),
  simple(150_000, "Petit salaire, mois complet"),
  simple(400_000, "Salaire moyen, mois complet"),
  simple(750_000, "Salaire au plafond CNPS"),
  simple(1_200_000, "Salaire au-dessus du plafond CNPS"),
  simple(3_000_000, "Cadre supérieur"),
  [
    "Embauche le 16 mars, 8 h sup à 20 %, prime, logement, transport, avance",
    {
      period: march,
      employer,
      employee: { baseSalary: 310_000, hireDate: "2026-03-16", endDate: null },
      overtime: [{ category: "hs_20", hoursHundredths: 800 }],
      items: [
        {
          code: "prime_rendement",
          label: "Prime de rendement",
          kind: "earning",
          amount: 20_000,
          subjectToCnps: true,
          taxable: true,
        },
        {
          code: "logement",
          label: "Avantage en nature logement",
          kind: "in_kind",
          amount: 30_000,
          subjectToCnps: true,
          taxable: true,
        },
        {
          code: "transport",
          label: "Indemnité de transport",
          kind: "non_taxable_allowance",
          amount: 15_000,
          subjectToCnps: false,
          taxable: false,
        },
        {
          code: "avance",
          label: "Avance sur salaire",
          kind: "deduction",
          amount: 10_000,
          subjectToCnps: false,
          taxable: false,
        },
      ],
    },
  ],
];

const SECTION: Record<string, string> = {
  earning: "Gain",
  allowance: "Indemnité hors brut",
  employee_contribution: "Retenue salariale",
  employer_contribution: "Charge patronale",
  deduction: "Retenue sur net",
};

const readme = [
  [t("Dossier de validation du moteur de paie PaieCam", true)],
  [
    t(
      `Généré le ${new Date().toISOString().slice(0, 10)} à partir du référentiel brouillon 2026 et du moteur de calcul.`,
    ),
  ],
  [
    t(
      "Objet : faire valider par écrit les taux, plafonds et barèmes 2026, puis les résultats de calcul, avant toute mise en production.",
    ),
  ],
  [
    t(
      "1. Feuille « Règles » : indiquez pour chaque règle « oui » si elle est juste, sinon la correction et le texte de référence.",
    ),
  ],
  [t("2. Feuille « Questions » : répondez à chaque point à trancher.")],
  [
    t(
      "3. Feuille « Cas de calcul » : pour chaque ligne, indiquez le montant que vous attendez s'il diffère.",
    ),
  ],
  [
    t(
      "Les cas validés deviendront les tests « golden » : le logiciel devra les reproduire au franc près à chaque évolution.",
    ),
  ],
  [t("Toutes les données sont fictives.")],
];

const ruleRows = [
  header(
    "Règle",
    "Date d'effet",
    "Valeur proposée",
    "Source relevée",
    "Validé ? (oui / non)",
    "Correction et texte de référence",
  ),
  ...rules.map((r) => [t(r.code), t(r.validFrom), t(describe(r)), t(r.legalSource), t(""), t("")]),
];

const questionRows = [
  header("N°", "Règle", "Question", "Réponse de l'expert-comptable"),
  ...rules
    .flatMap((r) => r.questions)
    .map((q, i) => [
      n(i + 1),
      t(rules.find((r) => r.questions.includes(q))?.code ?? ""),
      t(q),
      t(""),
    ]),
  ...[
    "Proratisation à l'entrée ou à la sortie : jours calendaires (choix actuel) ou base 30 jours ?",
    "Assiette de la CNPS : quelles primes et indemnités en sont exclues ?",
    "Valorisation des avantages en nature (logement, véhicule, nourriture…) : barèmes forfaitaires ?",
    "Primes exceptionnelles (13e mois, gratifications) : la loi de finances 2026 porte l'abattement des revenus exceptionnels à 35 % ; comment l'appliquer en retenue mensuelle ?",
    "Format exact attendu pour la DIPE et l'état des cotisations CNPS ? (Un format provisoire est généré : une ligne par salarié avec NIU employeur, n° employeur CNPS, période, matricule, nom, prénoms, n° CNPS, brut, taxable, assiette CNPS plafonnée, CNPS salariale, IRPP, CAC, CFC salariale, RAV, TDL.)",
    "Canal de dépôt de la DIPE et des déclarations : portail de la DGI, e-services CNPS ou dépôt papier ? Faut-il un fichier dans un format imposé (texte à largeur fixe, XML…) ?",
    "TDL : est-elle reversée à la commune de l'établissement employeur ou à celle du domicile du salarié ?",
    "Mentions obligatoires du bulletin de paie. Le PDF affiche aujourd'hui : raison sociale, NIU, n° employeur CNPS et commune de l'employeur ; nom, matricule, emploi, catégorie / échelon, date d'embauche, type de contrat et n° CNPS du salarié ; période ; gains avec base et taux ; indemnités hors brut ; retenues salariales ; retenues sur net ; charges patronales ; brut, total des retenues, net à payer, coût employeur ; cumuls annuels (brut, IRPP, net) ; code de vérification. Que faut-il ajouter (adresse, n° contribuable, congés, mode de paiement…) ?",
    "Langue du bulletin : un bulletin en français OU en anglais selon le salarié est-il conforme, ou faut-il un bulletin bilingue ?",
  ].map((q, i) => [n(rules.flatMap((r) => r.questions).length + i + 1), t("général"), t(q), t("")]),
];

const caseRows = [
  header(
    "Cas",
    "Rubrique",
    "Nature",
    "Assiette",
    "Montant calculé",
    "Détail du calcul",
    "Montant attendu selon vous",
  ),
];
scenarios.forEach(([label, input], i) => {
  const p = computePayslip(input, rules);
  caseRows.push([t(`Cas ${i + 1} — ${label}`, true), t(""), t(""), t(""), t(""), t(""), t("")]);
  for (const l of p.lines) {
    caseRows.push([
      t(`Cas ${i + 1}`),
      t(l.label),
      t(SECTION[l.section] ?? l.section),
      l.base === undefined ? t("") : n(l.base),
      n(l.amount),
      t(l.explanation),
      t(""),
    ]);
  }
  for (const [name, value] of [
    ["Brut", p.totals.gross],
    ["Total retenues salariales", p.totals.employeeContributions],
    ["Net à payer", p.totals.netPay],
    ["Total charges patronales", p.totals.employerContributions],
    ["Coût employeur", p.totals.employerCost],
  ] as const) {
    caseRows.push([t(`Cas ${i + 1}`), t(name, true), t("Total"), t(""), n(value), t(""), t("")]);
  }
});

await writeXlsxFile([
  { data: readme, sheet: "Lisez-moi", columns: [{ width: 110 }] },
  {
    data: ruleRows,
    sheet: "Règles",
    columns: [
      { width: 26 },
      { width: 12 },
      { width: 60 },
      { width: 50 },
      { width: 16 },
      { width: 50 },
    ],
  },
  {
    data: questionRows,
    sheet: "Questions",
    columns: [{ width: 5 }, { width: 24 }, { width: 90 }, { width: 60 }],
  },
  {
    data: caseRows,
    sheet: "Cas de calcul",
    columns: [
      { width: 12 },
      { width: 42 },
      { width: 18 },
      { width: 14 },
      { width: 14 },
      { width: 70 },
      { width: 22 },
    ],
  },
] as never).toFile(out);
console.warn(
  `Dossier écrit : ${out} (${rules.length} règles, ${questionRows.length - 1} questions, ${scenarios.length} cas)`,
);
