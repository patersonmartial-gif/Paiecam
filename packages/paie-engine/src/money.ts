/** Montant en francs CFA, toujours entier (pas de centimes). */
export type Fcfa = number;

/** Taux en points de base : 1 % = 100 bp, 4,2 % = 420 bp. */
export type BasisPoints = number;

export type Rounding = "nearest" | "down" | "up";

export function assertFcfa(amount: number, label = "montant"): asserts amount is Fcfa {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError(`${label} doit être un entier FCFA, reçu ${amount}`);
  }
}

export function assertBasisPoints(rate: number, label = "taux"): asserts rate is BasisPoints {
  if (!Number.isSafeInteger(rate) || rate < 0 || rate > 10_000) {
    throw new RangeError(
      `${label} doit être un entier de points de base entre 0 et 10000, reçu ${rate}`,
    );
  }
}

/** Division entière exacte avec règle d'arrondi (« nearest » = demi arrondi vers le haut). */
export function divRound(numerator: number, denominator: number, rounding: Rounding): number {
  if (denominator <= 0) throw new RangeError("le dénominateur doit être positif");
  const q = Math.floor(numerator / denominator);
  const r = numerator - q * denominator;
  if (r === 0) return q;
  switch (rounding) {
    case "down":
      return q;
    case "up":
      return q + 1;
    case "nearest":
      return 2 * r >= denominator ? q + 1 : q;
  }
}

/** Applique un taux en points de base à un montant, sans jamais passer par un flottant. */
export function applyRate(amount: Fcfa, rate: BasisPoints, rounding: Rounding = "nearest"): Fcfa {
  assertFcfa(amount);
  assertBasisPoints(rate);
  return divRound(amount * rate, 10_000, rounding);
}
