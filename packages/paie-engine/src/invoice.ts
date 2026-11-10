import { mulDiv } from "./brackets";
import { assertFcfa, type Fcfa } from "./money";
import { resolveRule, type IsoDate, type PayRule } from "./rules";
import { RULE_CODES } from "./types";

export type TaxCategory = "standard" | "exempt";

export interface InvoiceLineInput {
  label: string;
  quantity: number;
  /** Prix unitaire payé par le patient, taxes comprises (fixé librement par l'établissement). */
  unitPriceTtc: Fcfa;
  taxCategory: TaxCategory;
}

export interface InvoiceTaxLine {
  category: TaxCategory;
  rate: number;
  baseHt: Fcfa;
  tax: Fcfa;
  totalTtc: Fcfa;
}

export interface Invoice {
  lines: (InvoiceLineInput & { totalTtc: Fcfa })[];
  taxes: InvoiceTaxLine[];
  totalHt: Fcfa;
  totalTax: Fcfa;
  totalTtc: Fcfa;
  ruleUsed: { id?: string; code: string; validFrom: IsoDate; status: "draft" | "validated" };
}

/**
 * Totaux d'une facture. Les prix sont TTC : la taxe est extraite par catégorie
 * (HT = TTC × 10 000 / (10 000 + taux), arrondi selon la règle), et TVA = TTC − HT, de sorte que
 * HT + TVA = TTC au franc près. Aucun taux n'est écrit ici : tout vient de la règle « tva ».
 */
export function computeInvoice(
  lines: readonly InvoiceLineInput[],
  rules: readonly PayRule[],
  date: IsoDate,
): Invoice {
  if (lines.length === 0) throw new RangeError("une facture a au moins une ligne");
  const rule = resolveRule(rules, RULE_CODES.vat, date);
  const computed = lines.map((l) => {
    if (!Number.isSafeInteger(l.quantity) || l.quantity <= 0)
      throw new RangeError(`${l.label} : quantité invalide`);
    assertFcfa(l.unitPriceTtc, l.label);
    if (l.unitPriceTtc < 0) throw new RangeError(`${l.label} : prix négatif`);
    return { ...l, totalTtc: l.unitPriceTtc * l.quantity };
  });
  const taxes: InvoiceTaxLine[] = [];
  for (const category of ["standard", "exempt"] as const) {
    const ofCategory = computed.filter((l) => l.taxCategory === category);
    if (ofCategory.length === 0) continue;
    const totalTtc = ofCategory.reduce((sum, l) => sum + l.totalTtc, 0);
    const rate = rule.value.rates[category];
    const baseHt = mulDiv([totalTtc, 10_000], 10_000 + rate, rule.value.rounding);
    taxes.push({ category, rate, baseHt, tax: totalTtc - baseHt, totalTtc });
  }
  const totalTtc = computed.reduce((sum, l) => sum + l.totalTtc, 0);
  assertFcfa(totalTtc, "total de la facture");
  const totalHt = taxes.reduce((sum, t) => sum + t.baseHt, 0);
  return {
    lines: computed,
    taxes,
    totalHt,
    totalTax: totalTtc - totalHt,
    totalTtc,
    ruleUsed: {
      ...(rule.id ? { id: rule.id } : {}),
      code: rule.code,
      validFrom: rule.validFrom,
      status: rule.status ?? "draft",
    },
  };
}
