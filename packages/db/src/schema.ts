import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  inet,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";
import { users } from "./auth-schema";

export * from "./auth-schema";

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

export const regimeEnum = pgEnum("regime", ["general", "agricole", "enseignement_prive"]);

export const memberRoleEnum = pgEnum("member_role", [
  "owner",
  "payroll_manager",
  "accountant",
  "employee",
]);

/** Une entreprise cliente. RLS : visible uniquement quand app.tenant_id = id. */
export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey(),
    legalName: text("legal_name").notNull(),
    niu: text("niu").notNull(),
    cnpsEmployerNumber: text("cnps_employer_number").notNull(),
    regime: regimeEnum("regime").notNull(),
    /** Taux AT/MP notifié, en points de base (175, 250 ou 500). */
    workAccidentRate: integer("work_accident_rate").notNull(),
    commune: text("commune").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("tenants_niu_key").on(t.niu)],
);

/** Rôle d'un utilisateur dans une entreprise. RLS : par tenant, ou ses propres lignes. */
export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: memberRoleEnum("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("memberships_tenant_user_key").on(t.tenantId, t.userId),
    index("memberships_user_idx").on(t.userId),
  ],
);

/**
 * Journal des actions sensibles, en insertion seule (le rôle applicatif n'a ni UPDATE ni DELETE).
 * tenant_id est nul pour les événements hors entreprise (ex. échec de connexion).
 * before/after ne contiennent jamais de donnée personnelle en clair (utiliser maskPII()).
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    /** Pas de clé étrangère : la trace survit à la suppression du compte. */
    actorUserId: text("actor_user_id"),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    before: jsonb("before"),
    after: jsonb("after"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_tenant_created_idx").on(t.tenantId, t.createdAt)],
);

export const inviteRoleEnum = pgEnum("invite_role", ["payroll_manager", "accountant"]);

/**
 * Invitation d'un collaborateur. Seule l'empreinte SHA-256 du jeton est stockée.
 * RLS : visible par l'entreprise, ou par qui présente le jeton (app.invitation_token_hash).
 */
export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    email: text("email").notNull(),
    role: inviteRoleEnum("role").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: text("invited_by")
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedBy: text("accepted_by").references(() => users.id),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("invitations_tenant_idx").on(t.tenantId),
    check("invitations_email_lower_chk", sql`${t.email} = lower(${t.email})`),
  ],
);
