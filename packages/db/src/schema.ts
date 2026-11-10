import { sql } from "drizzle-orm";
import {
  primaryKey,
  boolean,
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
  "cashier",
  "stock_manager",
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
    /** Alerte de péremption des médicaments : nombre de jours avant la date de péremption. */
    expiryAlertDays: integer("expiry_alert_days").notNull().default(90),
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

export const inviteRoleEnum = pgEnum("invite_role", [
  "payroll_manager",
  "accountant",
  "cashier",
  "stock_manager",
]);

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

export const payItemKindEnum = pgEnum("pay_item_kind", [
  "earning",
  "in_kind",
  "non_taxable_allowance",
  "deduction",
]);
export const periodStatusEnum = pgEnum("pay_period_status", [
  "open",
  "calculated",
  "validated",
  "locked",
]);
export const payslipStatusEnum = pgEnum("payslip_status", ["provisional", "final"]);
export const languageEnum = pgEnum("language", ["fr", "en"]);
export const declarationKindEnum = pgEnum("declaration_kind", ["cnps", "dgi", "dipe"]);
export const declarationStatusEnum = pgEnum("declaration_status", ["generated", "filed", "paid"]);
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
    /** Langue du bulletin PDF. */
    payslipLanguage: languageEnum("payslip_language").notNull().default("fr"),
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

/** Rubriques de paie de l'entreprise (primes, indemnités, avantages, retenues). */
export const payItems = pgTable(
  "pay_items",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    code: text("code").notNull(),
    labelFr: text("label_fr").notNull(),
    labelEn: text("label_en").notNull(),
    kind: payItemKindEnum("kind").notNull(),
    subjectToCnps: boolean("subject_to_cnps").notNull(),
    taxable: boolean("taxable").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("pay_items_tenant_code_key").on(t.tenantId, t.code),
    unique("pay_items_tenant_id_id_key").on(t.tenantId, t.id),
    check("pay_items_code_chk", sql`${t.code} ~ '^[a-z0-9_]{1,40}$'`),
    // Une indemnité hors brut ou une retenue n'est ni cotisable ni imposable.
    check(
      "pay_items_flags_chk",
      sql`${t.kind} in ('earning', 'in_kind') or (not ${t.subjectToCnps} and not ${t.taxable})`,
    ),
  ],
);

/** Mois de paie : ouvert → calculé → validé (figé) → verrouillé (déclarations faites). */
export const payPeriods = pgTable(
  "pay_periods",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    year: integer("year").notNull(),
    month: integer("month").notNull(),
    status: periodStatusEnum("status").notNull().default("open"),
    calculatedAt: timestamp("calculated_at", { withTimezone: true }),
    validatedAt: timestamp("validated_at", { withTimezone: true }),
    validatedBy: text("validated_by"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("pay_periods_tenant_month_key").on(t.tenantId, t.year, t.month),
    unique("pay_periods_tenant_id_id_key").on(t.tenantId, t.id),
    check(
      "pay_periods_month_chk",
      sql`${t.month} between 1 and 12 and ${t.year} between 2020 and 2100`,
    ),
  ],
);

/**
 * Variables du mois pour un salarié. `key` désigne la variable :
 * « item:<code> » (montant FCFA d'une rubrique), « hs:<catégorie> » (heures en centièmes),
 * « absence » (jours d'absence non payés), « loan_skip:<prêt> » (échéance suspendue ce mois, valeur 1).
 */
export const payVariables = pgTable(
  "pay_variables",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    periodId: uuid("period_id")
      .notNull()
      .references(() => payPeriods.id),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    key: text("key").notNull(),
    value: integer("value").notNull(),
    updatedBy: text("updated_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("pay_variables_period_employee_key_key").on(t.periodId, t.employeeId, t.key),
    check(
      "pay_variables_key_chk",
      sql`${t.key} ~ '^(item:[a-z0-9_]{1,40}|hs:[a-z0-9_]{1,20}|absence|loan_skip:[0-9a-f-]{36})$'`,
    ),
    check("pay_variables_value_chk", sql`${t.value} >= 0`),
  ],
);

/** Bulletin calculé : entrées, règles utilisées et totaux conservés tels quels. */
export const payslips = pgTable(
  "payslips",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    periodId: uuid("period_id")
      .notNull()
      .references(() => payPeriods.id),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    status: payslipStatusEnum("status").notNull(),
    /** Entrée exacte du moteur (rejouable). */
    input: jsonb("input").notNull(),
    /** Instantané de la fiche salarié au moment du calcul (sans donnée chiffrée). */
    employeeSnapshot: jsonb("employee_snapshot").notNull(),
    rulesUsed: jsonb("rules_used").notNull(),
    totals: jsonb("totals").notNull(),
    warnings: jsonb("warnings").notNull(),
    gross: integer("gross").notNull(),
    netPay: integer("net_pay").notNull(),
    employerCost: integer("employer_cost").notNull(),
    calculatedAt: timestamp("calculated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("payslips_period_employee_key").on(t.periodId, t.employeeId),
    unique("payslips_tenant_id_id_key").on(t.tenantId, t.id),
    index("payslips_tenant_employee_idx").on(t.tenantId, t.employeeId),
  ],
);

export const payslipLines = pgTable(
  "payslip_lines",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    payslipId: uuid("payslip_id")
      .notNull()
      .references(() => payslips.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    code: text("code").notNull(),
    label: text("label").notNull(),
    section: text("section").notNull(),
    base: integer("base"),
    rate: integer("rate"),
    amount: integer("amount").notNull(),
    ruleCode: text("rule_code"),
    explanation: text("explanation").notNull(),
  },
  (t) => [unique("payslip_lines_position_key").on(t.payslipId, t.position)],
);

/**
 * Métadonnées des PDF (le fichier est chiffré dans le stockage objet).
 * `verificationCode` alimente le QR code de vérification publique ; il ne révèle rien du contenu.
 */
export const documents = pgTable(
  "documents",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    payslipId: uuid("payslip_id").references(() => payslips.id),
    kind: text("kind").notNull(),
    language: languageEnum("language").notNull(),
    /** Données publiques affichées par la page de vérification (rien sur le salarié). */
    issuerName: text("issuer_name").notNull(),
    periodYear: integer("period_year").notNull(),
    periodMonth: integer("period_month").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    /** HMAC du serveur sur « sha256|date d'émission|code ». */
    signature: text("signature").notNull(),
    verificationCode: text("verification_code").notNull().unique(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("documents_tenant_payslip_idx").on(t.tenantId, t.payslipId),
    unique("documents_tenant_id_id_key").on(t.tenantId, t.id),
  ],
);

/**
 * Déclaration d'un mois validé : générée → déposée → payée. Une fois déposée, son montant et
 * son fichier sont figés. Le mois ne se verrouille que lorsque toutes ses déclarations sont déposées.
 */
export const declarations = pgTable(
  "declarations",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    periodId: uuid("period_id")
      .notNull()
      .references(() => payPeriods.id),
    kind: declarationKindEnum("kind").notNull(),
    amountDue: integer("amount_due").notNull(),
    dueDate: date("due_date").notNull(),
    status: declarationStatusEnum("status").notNull().default("generated"),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    filedAt: date("filed_at"),
    filingReference: text("filing_reference"),
    paidAt: date("paid_at"),
    paymentReference: text("payment_reference"),
    updatedBy: text("updated_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("declarations_period_kind_key").on(t.periodId, t.kind),
    unique("declarations_tenant_id_id_key").on(t.tenantId, t.id),
    index("declarations_tenant_due_idx").on(t.tenantId, t.dueDate),
    check("declarations_amount_chk", sql`${t.amountDue} >= 0`),
    check(
      "declarations_filed_chk",
      sql`${t.status} = 'generated' or (${t.filedAt} is not null and ${t.filingReference} is not null)`,
    ),
    check("declarations_paid_chk", sql`${t.status} <> 'paid' or ${t.paidAt} is not null`),
  ],
);

/** Rappels d'échéance envoyés : un seul envoi par déclaration et par étape. */
export const reminderDeliveries = pgTable(
  "reminder_deliveries",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    declarationId: uuid("declaration_id")
      .notNull()
      .references(() => declarations.id),
    stage: text("stage").notNull(),
    channel: text("channel").notNull(),
    recipients: integer("recipients").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("reminder_deliveries_once_key").on(t.declarationId, t.stage, t.channel),
    check("reminder_deliveries_stage_chk", sql`${t.stage} in ('j-7', 'j-2', 'j0', 'late')`),
  ],
);

export const loanKindEnum = pgEnum("loan_kind", ["loan", "advance"]);
export const loanStatusEnum = pgEnum("loan_status", ["active", "settled", "cancelled"]);

/**
 * Prêt ou avance consenti à un salarié, remboursé par retenues mensuelles sur le net.
 * Montant, salarié et départ sont immuables ; seule la mensualité peut changer tant qu'il est en
 * cours (déclencheurs, migration 0022). Le solde = montant − remboursements des mois validés.
 */
export const employeeLoans = pgTable(
  "employee_loans",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    kind: loanKindEnum("kind").notNull(),
    label: text("label").notNull(),
    /** Montant prêté, en FCFA entiers. */
    principal: integer("principal").notNull(),
    /** Retenue mensuelle prévue (la dernière échéance est le reste dû). */
    installment: integer("installment").notNull(),
    grantedOn: date("granted_on").notNull(),
    /** Premier mois de paie où la retenue s'applique. */
    startYear: integer("start_year").notNull(),
    startMonth: integer("start_month").notNull(),
    status: loanStatusEnum("status").notNull().default("active"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: text("cancelled_by"),
  },
  (t) => [
    unique("employee_loans_tenant_id_id_key").on(t.tenantId, t.id),
    index("employee_loans_tenant_employee_idx").on(t.tenantId, t.employeeId),
    check("employee_loans_label_chk", sql`char_length(${t.label}) between 1 and 80`),
    check("employee_loans_principal_chk", sql`${t.principal} between 1 and 100000000`),
    check(
      "employee_loans_installment_chk",
      sql`${t.installment} >= 1 and ${t.installment} <= ${t.principal}`,
    ),
    check(
      "employee_loans_start_chk",
      sql`${t.startMonth} between 1 and 12 and ${t.startYear} between 2020 and 2100`,
    ),
    check(
      "employee_loans_cancel_chk",
      sql`(${t.status} = 'cancelled') = (${t.cancelledAt} is not null and ${t.cancelledBy} is not null)`,
    ),
  ],
);

/** Remboursement d'un prêt par la paie d'un mois validé. Jamais modifié ni supprimé. */
export const loanRepayments = pgTable(
  "loan_repayments",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    loanId: uuid("loan_id")
      .notNull()
      .references(() => employeeLoans.id),
    periodId: uuid("period_id")
      .notNull()
      .references(() => payPeriods.id),
    amount: integer("amount").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("loan_repayments_loan_period_key").on(t.loanId, t.periodId),
    index("loan_repayments_tenant_loan_idx").on(t.tenantId, t.loanId),
    check("loan_repayments_amount_chk", sql`${t.amount} >= 1`),
  ],
);

export const catalogKindEnum = pgEnum("catalog_kind", ["service", "medicine"]);
/** Catégorie fiscale d'un article ; les taux viennent de la règle « tva » (pay_rules), jamais du code. */
export const taxCategoryEnum = pgEnum("tax_category", ["standard", "exempt"]);

/**
 * Catalogue de l'établissement : prestations (consultation, soins, examens) et médicaments.
 * Le prix n'est pas ici : il a son historique (catalog_prices), une facture garde le sien.
 */
export const catalogItems = pgTable(
  "catalog_items",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    kind: catalogKindEnum("kind").notNull(),
    /** Code interne court (ex. CONS-GEN, PARA-500). */
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** Médicaments : forme (comprimé, sirop…), dosage, unité de vente (boîte, flacon…). */
    form: text("form"),
    dosage: text("dosage"),
    unit: text("unit"),
    taxCategory: taxCategoryEnum("tax_category").notNull(),
    /** Médicaments : alerte de rupture quand le stock disponible passe sous ce seuil. */
    alertThreshold: integer("alert_threshold").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("catalog_items_tenant_code_key").on(t.tenantId, t.code),
    unique("catalog_items_tenant_id_id_key").on(t.tenantId, t.id),
    check("catalog_items_code_chk", sql`${t.code} ~ '^[A-Z0-9][A-Z0-9_-]{0,29}$'`),
    check("catalog_items_name_chk", sql`char_length(${t.name}) between 1 and 120`),
    check("catalog_items_threshold_chk", sql`${t.alertThreshold} >= 0`),
  ],
);

/** Historique des prix de vente TTC (FCFA entiers) fixés librement par l'établissement. */
export const catalogPrices = pgTable(
  "catalog_prices",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => catalogItems.id),
    /** Prix payé par le patient, taxes comprises. */
    priceTtc: integer("price_ttc").notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
    setBy: text("set_by").notNull(),
  },
  (t) => [
    index("catalog_prices_item_idx").on(t.tenantId, t.itemId, t.validFrom),
    check("catalog_prices_amount_chk", sql`${t.priceTtc} between 0 and 100000000`),
  ],
);

/** Lot d'un médicament : la quantité n'évolue que par les mouvements (déclencheur, migration 0026). */
export const stockLots = pgTable(
  "stock_lots",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => catalogItems.id),
    lotNumber: text("lot_number").notNull(),
    expiryDate: date("expiry_date").notNull(),
    /** Coût d'achat unitaire (FCFA), pour la valeur du stock et la marge. */
    unitCost: integer("unit_cost").notNull(),
    supplier: text("supplier"),
    quantityOnHand: integer("quantity_on_hand").notNull().default(0),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    receivedBy: text("received_by").notNull(),
  },
  (t) => [
    unique("stock_lots_tenant_id_id_key").on(t.tenantId, t.id),
    unique("stock_lots_item_lot_expiry_key").on(t.tenantId, t.itemId, t.lotNumber, t.expiryDate),
    index("stock_lots_item_expiry_idx").on(t.tenantId, t.itemId, t.expiryDate),
    check("stock_lots_quantity_chk", sql`${t.quantityOnHand} >= 0`),
    check("stock_lots_cost_chk", sql`${t.unitCost} between 0 and 100000000`),
    check("stock_lots_number_chk", sql`char_length(${t.lotNumber}) between 1 and 40`),
  ],
);

export const stockMovementKindEnum = pgEnum("stock_movement_kind", [
  "reception",
  "sale",
  "sale_cancelled",
  "breakage",
  "expired",
  "inventory",
]);

/** Registre des mouvements de stock : jamais modifié ni supprimé. */
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    lotId: uuid("lot_id")
      .notNull()
      .references(() => stockLots.id),
    kind: stockMovementKindEnum("kind").notNull(),
    /** Positif pour une entrée, négatif pour une sortie. */
    quantity: integer("quantity").notNull(),
    reason: text("reason"),
    /** Vente ou annulation : facture concernée. */
    invoiceId: uuid("invoice_id"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("stock_movements_lot_idx").on(t.tenantId, t.lotId, t.createdAt),
    check("stock_movements_quantity_chk", sql`${t.quantity} <> 0`),
    check(
      "stock_movements_sign_chk",
      sql`(${t.kind} in ('reception', 'sale_cancelled') and ${t.quantity} > 0)
        or (${t.kind} in ('sale', 'breakage', 'expired') and ${t.quantity} < 0)
        or ${t.kind} = 'inventory'`,
    ),
    check(
      "stock_movements_reason_chk",
      sql`${t.kind} not in ('breakage', 'expired', 'inventory') or char_length(coalesce(${t.reason}, '')) between 3 and 200`,
    ),
  ],
);

export const invoiceKindEnum = pgEnum("invoice_kind", ["invoice", "credit_note"]);
export const invoiceStatusEnum = pgEnum("invoice_status", ["issued", "cancelled"]);
export const paymentMeanEnum = pgEnum("payment_mean", ["cash", "orange_money", "mtn_momo"]);

/** Compteur de numérotation : continu et sans trou, par année et par série (F : facture, A : avoir). */
export const invoiceCounters = pgTable(
  "invoice_counters",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    series: text("series").notNull(),
    year: integer("year").notNull(),
    lastNumber: integer("last_number").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.series, t.year] }),
    check("invoice_counters_series_chk", sql`${t.series} in ('F', 'A')`),
  ],
);

/**
 * Facture (ou avoir) émise au comptoir. Jamais modifiée : seule l'annulation d'une facture par un
 * avoir change son statut (déclencheurs, migration 0028). Montants en FCFA, prix TTC.
 */
export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    kind: invoiceKindEnum("kind").notNull(),
    series: text("series").notNull(),
    year: integer("year").notNull(),
    number: integer("number").notNull(),
    status: invoiceStatusEnum("status").notNull().default("issued"),
    /** Avoir : facture annulée. */
    creditedInvoiceId: uuid("credited_invoice_id"),
    /** Facultatif, chiffré (donnée de santé indirecte : ce que le patient a acheté). */
    patientNameEnc: text("patient_name_enc"),
    paymentMean: paymentMeanEnum("payment_mean").notNull(),
    paymentReference: text("payment_reference"),
    /** Raison sociale au jour de l'émission (affichée par la vérification publique). */
    issuerName: text("issuer_name").notNull(),
    totalHt: integer("total_ht").notNull(),
    totalTax: integer("total_tax").notNull(),
    totalTtc: integer("total_ttc").notNull(),
    taxes: jsonb("taxes").notNull(),
    ruleUsed: jsonb("rule_used").notNull(),
    verificationCode: text("verification_code").notNull().unique(),
    signature: text("signature").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    issuedBy: text("issued_by").notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: text("cancelled_by"),
    cancelReason: text("cancel_reason"),
  },
  (t) => [
    unique("invoices_tenant_number_key").on(t.tenantId, t.series, t.year, t.number),
    unique("invoices_tenant_id_id_key").on(t.tenantId, t.id),
    index("invoices_tenant_issued_idx").on(t.tenantId, t.issuedAt),
    check(
      "invoices_kind_series_chk",
      sql`(${t.kind} = 'invoice' and ${t.series} = 'F' and ${t.creditedInvoiceId} is null)
        or (${t.kind} = 'credit_note' and ${t.series} = 'A' and ${t.creditedInvoiceId} is not null)`,
    ),
    check(
      "invoices_totals_chk",
      sql`${t.totalHt} + ${t.totalTax} = ${t.totalTtc}
        and ((${t.kind} = 'invoice' and ${t.totalTtc} >= 0) or (${t.kind} = 'credit_note' and ${t.totalTtc} <= 0))`,
    ),
    check(
      "invoices_cancel_chk",
      sql`(${t.status} = 'cancelled') = (${t.cancelledAt} is not null and ${t.cancelledBy} is not null and ${t.cancelReason} is not null)`,
    ),
    check(
      "invoices_reference_chk",
      sql`${t.paymentMean} = 'cash' or char_length(coalesce(${t.paymentReference}, '')) between 4 and 40`,
    ),
  ],
);

/** Ligne de facture : copie figée de l'article, du prix et des lots sortis. */
export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    position: integer("position").notNull(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => catalogItems.id),
    kind: catalogKindEnum("kind").notNull(),
    code: text("code").notNull(),
    label: text("label").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceTtc: integer("unit_price_ttc").notNull(),
    taxCategory: taxCategoryEnum("tax_category").notNull(),
    totalTtc: integer("total_ttc").notNull(),
    /** Médicaments : lots sortis [{ lotId, lotNumber, expiryDate, quantity }]. */
    lots: jsonb("lots").notNull().default(sql`'[]'::jsonb`),
  },
  (t) => [
    unique("invoice_lines_invoice_position_key").on(t.invoiceId, t.position),
    check("invoice_lines_total_chk", sql`${t.totalTtc} = ${t.quantity} * ${t.unitPriceTtc}`),
    check("invoice_lines_quantity_chk", sql`${t.quantity} <> 0`),
  ],
);

