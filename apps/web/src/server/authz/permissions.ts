export type Role =
  "owner" | "payroll_manager" | "accountant" | "employee" | "cashier" | "stock_manager";

/** Une permission par capacité ; les actions la déclarent, jamais l'interface. */
export const PERMISSIONS = [
  "tenant:read",
  "tenant:update",
  "members:read",
  "members:manage",
  "employees:read",
  "employees:write",
  /** Voir en clair le n° CNPS, l'IBAN et le numéro mobile money (lecture auditée). */
  "employees:sensitive",
  "payroll:read",
  "payroll:run",
  "payroll:validate",
  "declarations:read",
  "declarations:generate",
  "audit:read",
  "catalog:read",
  /** Créer les articles et fixer librement les prix (propriétaire). */
  "catalog:manage",
  "billing:read",
  "billing:issue",
  /** Annuler une facture par un avoir (propriétaire, mot de passe ressaisi). */
  "billing:cancel",
  "stock:read",
  "stock:manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const READ_ONLY: Permission[] = PERMISSIONS.filter((p) => p.endsWith(":read"));

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  payroll_manager: [
    "tenant:read",
    "members:read",
    "employees:read",
    "employees:write",
    /** Voir en clair le n° CNPS, l'IBAN et le numéro mobile money (lecture auditée). */
    "employees:sensitive",
    "payroll:read",
    "payroll:run",
    "payroll:validate",
    "declarations:read",
    "declarations:generate",
  ],
  // Le comptable consulte tout, ne modifie rien.
  accountant: READ_ONLY,
  // Caisse : facture et encaisse au comptoir, consulte le stock ; ne touche ni aux prix ni à la paie.
  cashier: ["tenant:read", "catalog:read", "billing:read", "billing:issue", "stock:read"],
  // Pharmacie : réceptions, inventaires, casse et périmés ; ne facture pas.
  stock_manager: ["tenant:read", "catalog:read", "stock:read", "stock:manage"],
  // Le salarié n'accède qu'à ses propres documents, via le portail (V2), pas via ces permissions.
  employee: [],
};

/** Rôles qui modifient des données (paie, caisse, stock) : la 2FA leur est obligatoire. */
export const ROLES_REQUIRING_2FA: readonly Role[] = [
  "owner",
  "payroll_manager",
  "cashier",
  "stock_manager",
];

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
