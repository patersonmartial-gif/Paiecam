import { uuidv7 } from "uuidv7";
import { z } from "zod";
import { inArray, schema, type Db } from "@paiecam/db";
import { blindIndex, type Keyring } from "@paiecam/security";
import { employeeSchema, type Employee } from "@/lib/employee-schema";
import { MAX_ROWS } from "../import/employees-sheet";
import { createTenantAction } from "../authz/action";
import { cnpsColumns } from "./employees";

export interface ImportRowError {
  line: number;
  /** Champs invalides (clés de la fiche) ou motif global de la ligne. */
  fields: string[];
  reason?: "duplicate_matricule" | "duplicate_cnps" | "existing_matricule" | "existing_cnps";
}

export interface ImportReport {
  total: number;
  valid: number;
  errors: ImportRowError[];
  imported: number;
}

const rowSchema = z.object({
  line: z.number().int().positive(),
  data: z.record(z.string(), z.string()),
});

/**
 * Import de salariés en deux temps, sans stocker le fichier : l'aperçu (`commit: false`) valide
 * tout et liste les erreurs ; la confirmation (`commit: true`) revalide et importe tout ou rien.
 */
export function makeImportEmployees(db: Db, keyring: Keyring) {
  return createTenantAction(
    db,
    {
      permission: "employees:write",
      input: z.object({ rows: z.array(rowSchema).min(1).max(MAX_ROWS), commit: z.boolean() }),
      audit: "employees.import",
    },
    async ({ tx, tenantId, audit }, input): Promise<ImportReport> => {
      const errors: ImportRowError[] = [];
      const valid: { line: number; employee: Employee; cnpsIndex: string | null }[] = [];
      const seenMatricules = new Map<string, number>();
      const seenCnps = new Map<string, number>();

      for (const row of input.rows) {
        const parsed = employeeSchema.safeParse(row.data);
        if (!parsed.success) {
          errors.push({
            line: row.line,
            fields: [...new Set(parsed.error.issues.map((i) => String(i.path[0])))],
          });
          continue;
        }
        const e = parsed.data;
        const matriculeKey = e.matricule.toUpperCase();
        if (seenMatricules.has(matriculeKey)) {
          errors.push({ line: row.line, fields: ["matricule"], reason: "duplicate_matricule" });
          continue;
        }
        seenMatricules.set(matriculeKey, row.line);
        const cnpsIndex = e.cnpsNumber ? blindIndex(keyring, tenantId, "cnps", e.cnpsNumber) : null;
        if (cnpsIndex && seenCnps.has(cnpsIndex)) {
          errors.push({ line: row.line, fields: ["cnpsNumber"], reason: "duplicate_cnps" });
          continue;
        }
        if (cnpsIndex) seenCnps.set(cnpsIndex, row.line);
        valid.push({ line: row.line, employee: e, cnpsIndex });
      }

      // Doublons avec les salariés déjà enregistrés (y compris sortis).
      const matricules = valid.map((v) => v.employee.matricule);
      const indexes = valid.flatMap((v) => (v.cnpsIndex ? [v.cnpsIndex] : []));
      const existingM = new Set(
        matricules.length
          ? (
              await tx
                .select({ m: schema.employees.matricule })
                .from(schema.employees)
                .where(inArray(schema.employees.matricule, matricules))
            ).map((r) => r.m)
          : [],
      );
      const existingC = new Set(
        indexes.length
          ? (
              await tx
                .select({ i: schema.employees.cnpsNumberIndex })
                .from(schema.employees)
                .where(inArray(schema.employees.cnpsNumberIndex, indexes))
            ).map((r) => r.i)
          : [],
      );
      const ready = valid.filter((v) => {
        if (existingM.has(v.employee.matricule)) {
          errors.push({ line: v.line, fields: ["matricule"], reason: "existing_matricule" });
          return false;
        }
        if (v.cnpsIndex && existingC.has(v.cnpsIndex)) {
          errors.push({ line: v.line, fields: ["cnpsNumber"], reason: "existing_cnps" });
          return false;
        }
        return true;
      });
      errors.sort((a, b) => a.line - b.line);

      const report: ImportReport = {
        total: input.rows.length,
        valid: ready.length,
        errors,
        imported: 0,
      };
      if (!input.commit || errors.length > 0) {
        audit({
          entityType: "employee",
          after: { preview: true, total: report.total, errors: errors.length },
        });
        return report;
      }

      await tx.insert(schema.employees).values(
        ready.map(({ employee }) => {
          const id = uuidv7();
          const { cnpsNumber, endDate, ...fields } = employee;
          return {
            id,
            tenantId,
            ...fields,
            endDate: endDate ?? null,
            ...cnpsColumns(keyring, tenantId, id, cnpsNumber),
          };
        }),
      );
      audit({ entityType: "employee", after: { imported: ready.length } });
      return { ...report, imported: ready.length };
    },
  );
}
