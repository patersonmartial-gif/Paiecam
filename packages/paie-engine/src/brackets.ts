import { divRound, type BasisPoints, type Fcfa, type Rounding } from "./money";

interface Bracket {
  from: Fcfa;
  to: Fcfa | null;
}

/** Montant forfaitaire de la tranche qui contient `value` (RAV, TDL). */
export function bracketAmount(
  brackets: readonly (Bracket & { amount: Fcfa })[],
  value: Fcfa,
): Fcfa {
  const b = brackets.find((x) => value >= x.from && (x.to === null || value <= x.to));
  if (!b) throw new RangeError(`aucune tranche pour ${value}`);
  return b.amount;
}

/**
 * Impôt progressif par tranches, divisé par `divisor` (12 pour passer de l'annuel au mensuel)
 * avec un seul arrondi final : le résultat ne dépend pas de l'accumulation d'arrondis par tranche.
 */
export function progressiveTax(
  brackets: readonly (Bracket & { rate: BasisPoints })[],
  income: Fcfa,
  rounding: Rounding,
  divisor = 1,
): Fcfa {
  if (income <= 0) return 0;
  let numerator = 0;
  for (const b of brackets) {
    const lower = b.from === 0 ? 0 : b.from - 1;
    const upper = b.to === null ? income : Math.min(income, b.to);
    if (upper > lower) numerator += (upper - lower) * b.rate;
  }
  return divRound(numerator, 10_000 * divisor, rounding);
}

/** a × b × c / d avec arrondi, en entiers longs (aucun dépassement ni flottant). */
export function mulDiv(
  factors: readonly number[],
  denominator: number,
  rounding: Rounding,
): number {
  let n = 1n;
  for (const f of factors) {
    if (!Number.isSafeInteger(f)) throw new RangeError(`facteur non entier : ${f}`);
    n *= BigInt(f);
  }
  const d = BigInt(denominator);
  if (d <= 0n) throw new RangeError("le dénominateur doit être positif");
  let q = n / d;
  const r = n - q * d;
  if (r !== 0n) {
    if (rounding === "up" || (rounding === "nearest" && 2n * r >= d)) q += 1n;
  }
  return Number(q);
}
