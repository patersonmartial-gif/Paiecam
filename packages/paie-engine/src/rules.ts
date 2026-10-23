import { ruleSchemas, type RuleCode, type RuleValue } from "./types";

/** Date ISO « AAAA-MM-JJ ». Comparable lexicographiquement. */
export type IsoDate = string;

/** Une règle versionnée, miroir d'une ligne de la table pay_rules. */
export interface PayRule<V = unknown> {
  /** Identifiant de la ligne pay_rules (absent dans les jeux de test). */
  id?: string;
  code: string;
  validFrom: IsoDate;
  /** Inclusif. null = toujours en vigueur. */
  validTo: IsoDate | null;
  value: V;
  /** « draft » tant que l'expert-comptable n'a pas validé la règle par écrit. */
  status?: "draft" | "validated";
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertIsoDate(date: string): void {
  if (!ISO_DATE.test(date)) throw new RangeError(`date ISO invalide : ${date}`);
}

/**
 * Renvoie la règle `code` en vigueur à `date`, avec sa valeur validée par son schéma.
 * Lève une erreur si aucune règle ne s'applique ou si plusieurs se chevauchent :
 * une paie ne doit jamais être calculée sur un référentiel ambigu.
 */
export function resolveRule<C extends RuleCode>(
  rules: readonly PayRule[],
  code: C,
  date: IsoDate,
): PayRule<RuleValue<C>> {
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
  const rule = matches[0] as PayRule;
  const parsed = ruleSchemas[code].safeParse(rule.value);
  if (!parsed.success) {
    throw new Error(
      `règle « ${code} » du ${rule.validFrom} invalide : ${parsed.error.issues[0]?.message}`,
    );
  }
  return { ...rule, value: parsed.data as RuleValue<C> };
}

export interface RuleIssue {
  code: string;
  validFrom?: IsoDate;
  problem: "unknown_code" | "invalid_value" | "invalid_dates" | "overlap" | "gap";
  detail?: string;
}

function dayAfter(date: IsoDate): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Contrôle d'un référentiel complet (commande `pnpm rules:check`) : codes connus, valeurs
 * conformes, et pour chaque code des périodes qui ne se chevauchent pas et ne laissent pas de trou.
 */
export function checkRuleSet(rules: readonly PayRule[]): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const byCode = new Map<string, PayRule[]>();
  for (const r of rules) {
    const schema = (ruleSchemas as Record<string, (typeof ruleSchemas)[RuleCode]>)[r.code];
    if (!schema) {
      issues.push({ code: r.code, validFrom: r.validFrom, problem: "unknown_code" });
      continue;
    }
    if (
      !ISO_DATE.test(r.validFrom) ||
      (r.validTo !== null && (!ISO_DATE.test(r.validTo) || r.validTo < r.validFrom))
    ) {
      issues.push({ code: r.code, validFrom: r.validFrom, problem: "invalid_dates" });
      continue;
    }
    const parsed = schema.safeParse(r.value);
    if (!parsed.success) {
      issues.push({
        code: r.code,
        validFrom: r.validFrom,
        problem: "invalid_value",
        detail: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      });
    }
    byCode.set(r.code, [...(byCode.get(r.code) ?? []), r]);
  }
  for (const [code, list] of byCode) {
    const sorted = [...list].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1] as PayRule;
      const cur = sorted[i] as PayRule;
      if (prev.validTo === null || prev.validTo >= cur.validFrom) {
        issues.push({ code, validFrom: cur.validFrom, problem: "overlap" });
      } else if (dayAfter(prev.validTo) !== cur.validFrom) {
        issues.push({
          code,
          validFrom: cur.validFrom,
          problem: "gap",
          detail: `après le ${prev.validTo}`,
        });
      }
    }
  }
  return issues;
}

/** Refuse de calculer avec une règle non validée (exigé en production). */
export function assertValidated(rules: readonly PayRule[]): void {
  const drafts = rules.filter((r) => r.status !== "validated");
  if (drafts.length > 0) {
    throw new Error(
      `règles non validées par l'expert-comptable : ${drafts.map((r) => `${r.code} (${r.validFrom})`).join(", ")}`,
    );
  }
}
