import { z } from "zod";
import { and, asc, eq, ilike, isNull, or, schema, type Db, type Tx } from "@paiecam/db";
import { blindIndex, decryptField, encryptField, type Keyring } from "@paiecam/security";
import { bankDetailsSchema, employeeSchema, type Employee } from "@/lib/employee-schema";
import { createTenantAction, RuleError } from "../authz/action";

type Row = typeof schema.employees.$inferSelect;

/** Affichage masqué à partir des 4 derniers caractères stockés en clair. */
const masked = (last4: string | null | undefined) => (last4 ? `•••• ${last4}` : null);

const cnpsCtx = (tenantId: string, employeeId: string) => ({
  tenantId,
  table: "employees",
  column: "cnps_number",
  rowId: employeeId,
});
const bankCtx = (tenantId: string, employeeId: string, column: "iban" | "mobile_number") => ({
  tenantId,
  table: "employee_bank_details",
  column,
  rowId: employeeId,
});

/** Colonnes chiffrées du n° CNPS pour un salarié. */
export function cnpsColumns(
  keyring: Keyring,
  tenantId: string,
  employeeId: string,
  cnps: string | undefined,
) {
  if (!cnps) return { cnpsNumberEnc: null, cnpsNumberIndex: null, cnpsNumberLast4: null };
  return {
    cnpsNumberEnc: encryptField(keyring, cnpsCtx(tenantId, employeeId), cnps),
    cnpsNumberIndex: blindIndex(keyring, tenantId, "cnps", cnps),
    cnpsNumberLast4: cnps.slice(-4),
  };
}

/** Vue publique d'une fiche : jamais de valeur chiffrée ni d'empreinte. */
function view(row: Row) {
  return {
    id: row.id,
    matricule: row.matricule,
    lastName: row.lastName,
    firstNames: row.firstNames,
    birthDate: row.birthDate,
    cnpsNumberMasked: masked(row.cnpsNumberLast4),
    hireDate: row.hireDate,
    endDate: row.endDate,
    contractType: row.contractType,
    jobTitle: row.jobTitle,
    category: row.category,
    echelon: row.echelon,
    baseSalary: row.baseSalary,
    maritalStatus: row.maritalStatus,
    childrenCount: row.childrenCount,
    paymentMethod: row.paymentMethod,
    archivedAt: row.archivedAt,
  };
}
export type EmployeeView = ReturnType<typeof view>;

async function findEmployee(tx: Tx, employeeId: string): Promise<Row> {
  const [row] = await tx.select().from(schema.employees).where(eq(schema.employees.id, employeeId));
  if (!row) throw new RuleError("not_found");
  return row;
}

/** Données de la fiche sans les champs dérivés, pour l'audit (masqué ensuite par maskPII). */
function auditable(e: Partial<Employee>) {
  const { cnpsNumber, ...rest } = e;
  return { ...rest, cnpsNumber: cnpsNumber ? "changed" : undefined };
}

export function makeListEmployees(db: Db) {
  return createTenantAction(
    db,
    {
      permission: "employees:read",
      input: z.object({
        q: z.string().trim().max(100).optional(),
        archived: z.boolean().optional(),
      }),
      audit: "employees.list",
      skipAudit: true,
    },
    async ({ tx }, input) => {
      const filters = [input.archived ? undefined : isNull(schema.employees.archivedAt)];
      if (input.q) {
        const like = `%${input.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
        filters.push(
          or(
            ilike(schema.employees.lastName, like),
            ilike(schema.employees.firstNames, like),
            ilike(schema.employees.matricule, like),
          ),
        );
      }
      const rows = await tx
        .select()
        .from(schema.employees)
        .where(and(...filters))
        .orderBy(asc(schema.employees.lastName), asc(schema.employees.firstNames))
        .limit(500);
      return rows.map(view);
    },
  );
}

export function makeGetEmployee(db: Db) {
  return createTenantAction(
    db,
    {
      permission: "employees:read",
      input: z.object({ id: z.uuid() }),
      audit: "employees.read",
      skipAudit: true,
    },
    async ({ tx }, input) => {
      const row = await findEmployee(tx, input.id);
      const [bank] = await tx
        .select()
        .from(schema.employeeBankDetails)
        .where(eq(schema.employeeBankDetails.employeeId, row.id));
      return {
        employee: view(row),
        bank: {
          ibanMasked: masked(bank?.ibanLast4),
          mobileOperator: bank?.mobileOperator ?? null,
          mobileNumberMasked: masked(bank?.mobileNumberLast4),
        },
      };
    },
  );
}

export function makeCreateEmployee(db: Db, keyring: Keyring) {
  return createTenantAction(
    db,
    { permission: "employees:write", input: employeeSchema, audit: "employees.create" },
    async ({ tx, tenantId, audit }, input) => {
      const id = (await import("uuidv7")).uuidv7();
      const { cnpsNumber, endDate, ...fields } = input;
      await tx.insert(schema.employees).values({
        id,
        tenantId,
        ...fields,
        endDate: endDate ?? null,
        ...cnpsColumns(keyring, tenantId, id, cnpsNumber),
      });
      audit({ entityType: "employee", entityId: id, after: auditable(input) });
      return { id };
    },
  );
}

export function makeUpdateEmployee(db: Db, keyring: Keyring) {
  return createTenantAction(
    db,
    {
      permission: "employees:write",
      input: z.object({ id: z.uuid(), data: employeeSchema }),
      audit: "employees.update",
    },
    async ({ tx, tenantId, audit }, { id, data }) => {
      const before = await findEmployee(tx, id);
      if (before.archivedAt) throw new RuleError("archived");
      const { cnpsNumber, endDate, ...fields } = data;
      // N° CNPS vide = on garde l'actuel (il n'est jamais renvoyé en clair au formulaire).
      const cnps = cnpsNumber ? cnpsColumns(keyring, tenantId, id, cnpsNumber) : {};
      await tx
        .update(schema.employees)
        .set({ ...fields, endDate: endDate ?? null, ...cnps, updatedAt: new Date() })
        .where(eq(schema.employees.id, id));
      audit({ entityType: "employee", entityId: id, before: view(before), after: auditable(data) });
      return { id };
    },
  );
}

export function makeArchiveEmployee(db: Db) {
  return createTenantAction(
    db,
    {
      permission: "employees:write",
      input: z.object({ id: z.uuid(), endDate: z.iso.date() }),
      audit: "employees.archive",
    },
    async ({ tx, audit }, input) => {
      const row = await findEmployee(tx, input.id);
      if (row.archivedAt) throw new RuleError("archived");
      if (input.endDate < row.hireDate) throw new RuleError("end_before_hire");
      await tx
        .update(schema.employees)
        .set({ archivedAt: new Date(), endDate: input.endDate, updatedAt: new Date() })
        .where(eq(schema.employees.id, input.id));
      audit({ entityType: "employee", entityId: input.id, after: { endDate: input.endDate } });
      return { id: input.id };
    },
  );
}

export function makeUpdateBankDetails(
  db: Db,
  deps: {
    keyring: Keyring;
    verifyPassword: (userId: string, password: string) => Promise<boolean>;
  },
) {
  return createTenantAction(
    db,
    {
      permission: "employees:write",
      input: z.object({
        id: z.uuid(),
        password: z.string().min(1).max(128),
        bank: bankDetailsSchema,
      }),
      audit: "employees.update_bank_details",
    },
    async ({ tx, tenantId, userId, audit }, { id, password, bank }) => {
      // Opération sensible : le mot de passe est redemandé, même avec une session valide.
      if (!(await deps.verifyPassword(userId, password))) throw new RuleError("bad_password");
      const row = await findEmployee(tx, id);
      if (row.archivedAt) throw new RuleError("archived");
      const values = {
        tenantId,
        employeeId: id,
        ibanEnc: bank.iban
          ? encryptField(deps.keyring, bankCtx(tenantId, id, "iban"), bank.iban)
          : null,
        ibanLast4: bank.iban ? bank.iban.slice(-4) : null,
        mobileOperator: bank.mobileOperator ?? null,
        mobileNumberEnc: bank.mobileNumber
          ? encryptField(deps.keyring, bankCtx(tenantId, id, "mobile_number"), bank.mobileNumber)
          : null,
        mobileNumberLast4: bank.mobileNumber ? bank.mobileNumber.slice(-4) : null,
        updatedBy: userId,
        updatedAt: new Date(),
      };
      await tx
        .insert(schema.employeeBankDetails)
        .values(values)
        .onConflictDoUpdate({ target: schema.employeeBankDetails.employeeId, set: values });
      audit({
        entityType: "employee",
        entityId: id,
        after: {
          iban: bank.iban ? "changed" : "removed",
          mobileOperator: bank.mobileOperator ?? null,
        },
      });
      return { id };
    },
  );
}

/** Affiche en clair les champs chiffrés d'un salarié. Chaque lecture est auditée. */
export function makeRevealSensitive(db: Db, keyring: Keyring) {
  return createTenantAction(
    db,
    {
      permission: "employees:sensitive",
      input: z.object({ id: z.uuid() }),
      audit: "employees.reveal_sensitive",
    },
    async ({ tx, tenantId, audit }, input) => {
      const row = await findEmployee(tx, input.id);
      const [bank] = await tx
        .select()
        .from(schema.employeeBankDetails)
        .where(eq(schema.employeeBankDetails.employeeId, row.id));
      audit({ entityType: "employee", entityId: row.id });
      return {
        cnpsNumber: row.cnpsNumberEnc
          ? decryptField(keyring, cnpsCtx(tenantId, row.id), row.cnpsNumberEnc)
          : null,
        iban: bank?.ibanEnc
          ? decryptField(keyring, bankCtx(tenantId, row.id, "iban"), bank.ibanEnc)
          : null,
        mobileNumber: bank?.mobileNumberEnc
          ? decryptField(keyring, bankCtx(tenantId, row.id, "mobile_number"), bank.mobileNumberEnc)
          : null,
      };
    },
  );
}
