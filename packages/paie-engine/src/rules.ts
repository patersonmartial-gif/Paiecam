/** Date ISO « AAAA-MM-JJ ». Comparable lexicographiquement. */
export type IsoDate = string;

/** Une règle versionnée, miroir d'une ligne de la table pay_rules. */
export interface PayRule<V = unknown> {
  code: string;
  validFrom: IsoDate;
  /** Inclusif. null = toujours en vigueur. */
  validTo: IsoDate | null;
  value: V;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertIsoDate(date: string): void {
  if (!ISO_DATE.test(date)) throw new RangeError(`date ISO invalide : ${date}`);
}

/**
 * Renvoie la règle `code` en vigueur à `date`.
 * Lève une erreur si aucune règle ne s'applique ou si plusieurs se chevauchent :
 * une paie ne doit jamais être calculée sur un référentiel ambigu.
 */
export function resolveRule<V>(rules: readonly PayRule[], code: string, date: IsoDate): PayRule<V> {
  assertIsoDate(date);
  const matches = rules.filter(
    (r) => r.code === code && r.validFrom <= date && (r.validTo === null || date <= r.validTo),
  );
  if (matches.length === 0) {
    throw new Error(`aucune règle « ${code} » en vigueur au ${date}`);
  }
  if (matches.length > 1) {
    throw new Error(`plusieurs règles « ${code} » se chevauchent au ${date}`);
  }
  return matches[0] as PayRule<V>;
}
