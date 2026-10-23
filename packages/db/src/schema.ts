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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";
import { users } from "./auth-schema";

export * from "./auth-schema";

const id = () =>
  uuid("id")
    .primaryKey()
    .$defaultFn(() => uuidv7());

export const ruleStatusEnum = pgEnum("rule_status", ["draft", "validated"]);

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
    /** Points à faire trancher par l'expert-comptable. */
    questions: jsonb("questions").$type<string[]>().notNull().default([]),
    /** « draft » tant que l'expert-comptable n'a pas validé par écrit ; le moteur refuse les brouillons en production. */
    status: ruleStatusEnum("status").notNull().default("draft"),
    validatedBy: text("validated_by"),
    validatedAt: timestamp("validated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("pay_rules_code_valid_from_idx").on(t.code, t.validFrom),
    unique("pay_rules_code_valid_from_key").on(t.code, t.validFrom),
    check(
      "pay_rules_validation_chk",
      sql`(${t.status} = 'validated') = (${t.validatedBy} is not null and ${t.validatedAt} is not null)`,
    ),
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

export const contractTypeEnum = pgEnum("contract_type", ["cdi", "cdd"]);
export const maritalStatusEnum = pgEnum("marital_status", [
  "single",
  "married",
  "divorced",
  "widowed",
]);
export const paymentMethodEnum = pgEnum("payment_method", [
  "bank_transfer",
  "mobile_money",
  "cash",
]);
export const mobileOperatorEnum = pgEnum("mobile_operator", ["orange", "mtn"]);

/**
 * Fiche salarié : uniquement ce que la paie exige (minimisation, loi 2024/017).
 * Pas de photo, religion, ethnie ni donnée de santé. Le n° CNPS est chiffré ; son empreinte
 * (blind index) garantit l'unicité dans l'entreprise sans le déchiffrer.
 */
export const employees = pgTable(
  "employees",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    matricule: text("matricule").notNull(),
    lastName: text("last_name").notNull(),
    firstNames: text("first_names").notNull(),
    birthDate: date("birth_date").notNull(),
    cnpsNumberEnc: text("cnps_number_enc"),
    cnpsNumberIndex: text("cnps_number_index"),
    cnpsNumberLast4: text("cnps_number_last4"),
    hireDate: date("hire_date").notNull(),
    endDate: date("end_date"),
    contractType: contractTypeEnum("contract_type").notNull(),
    jobTitle: text("job_title").notNull(),
    category: text("category").notNull(),
    echelon: text("echelon").notNull(),
    /** Salaire de base mensuel, en FCFA entiers. */
    baseSalary: integer("base_salary").notNull(),
    maritalStatus: maritalStatusEnum("marital_status").notNull(),
    childrenCount: integer("children_count").notNull().default(0),
    paymentMethod: paymentMethodEnum("payment_method").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("employees_tenant_matricule_key").on(t.tenantId, t.matricule),
    uniqueIndex("employees_tenant_cnps_key")
      .on(t.tenantId, t.cnpsNumberIndex)
      .where(sql`${t.cnpsNumberIndex} is not null`),
    index("employees_tenant_name_idx").on(t.tenantId, t.lastName),
    check("employees_base_salary_chk", sql`${t.baseSalary} >= 0`),
    check("employees_children_chk", sql`${t.childrenCount} between 0 and 30`),
    check("employees_dates_chk", sql`${t.hireDate} > ${t.birthDate}`),
    check("employees_end_date_chk", sql`${t.endDate} is null or ${t.endDate} >= ${t.hireDate}`),
    check(
      "employees_cnps_consistency_chk",
      sql`(${t.cnpsNumberEnc} is null) = (${t.cnpsNumberIndex} is null)`,
    ),
  ],
);

/**
 * Coordonnées de paiement, chiffrées champ par champ. Les 4 derniers caractères sont gardés
 * en clair pour l'affichage masqué, sans déchiffrer.
 */
export const employeeBankDetails = pgTable(
  "employee_bank_details",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    employeeId: uuid("employee_id")
      .notNull()
      .unique()
      .references(() => employees.id),
    ibanEnc: text("iban_enc"),
    ibanLast4: text("iban_last4"),
    mobileOperator: mobileOperatorEnum("mobile_operator"),
    mobileNumberEnc: text("mobile_number_enc"),
    mobileNumberLast4: text("mobile_number_last4"),
    updatedBy: text("updated_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("employee_bank_details_tenant_idx").on(t.tenantId),
    check(
      "employee_bank_details_mobile_chk",
      sql`(${t.mobileNumberEnc} is null) = (${t.mobileOperator} is null)`,
    ),
  ],
);
