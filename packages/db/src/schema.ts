import { sql } from "drizzle-orm";
import { check, date, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";

const id = () =>
  uuid("id")
    .primaryKey()
    .$defaultFn(() => uuidv7());

/**
 * Référentiel global des taux, plafonds et barèmes (pas de tenant_id).
 * `value` a la forme attendue par le moteur pour ce `code` (voir packages/paie-engine/src/types.ts).
 * Une ligne publiée n'est jamais modifiée : on ferme sa période (valid_to) et on en crée une nouvelle.
 */
export const payRules = pgTable(
  "pay_rules",
  {
    id: id(),
    code: text("code").notNull(),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    value: jsonb("value").notNull(),
    /** Référence du texte (loi de finances, décret, circulaire CNPS). */
    legalSource: text("legal_source").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("pay_rules_code_valid_from_idx").on(t.code, t.validFrom),
    check("pay_rules_period_chk", sql`${t.validTo} is null or ${t.validTo} >= ${t.validFrom}`),
  ],
);
