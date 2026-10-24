import { z } from "zod";
import { and, asc, eq, inArray, schema, type Db } from "@paiecam/db";
import {
  amount as formatAmount,
  renderDataExportPdf,
  type DataExportSection,
} from "@paiecam/documents";
import { decryptField, type Keyring } from "@paiecam/security";
import { createTenantAction, RuleError } from "../authz/action";

const amount = (n: number) => `${formatAmount(n)} FCFA`;
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Droit d'accès (loi n° 2024/017, RGPD art. 15) : toutes les données détenues sur un salarié,
 * en JSON (lisible par une machine) et en PDF (lisible par la personne). L'export est audité.
 * Réservé aux rôles qui voient les données en clair : l'entreprise (responsable du traitement)
 * le transmet ensuite au salarié.
 */
export function makeExportEmployeeData(db: Db, keyring: Keyring) {
  return createTenantAction(
    db,
    {
      permission: "employees:sensitive",
      input: z.object({ employeeId: z.uuid(), format: z.enum(["json", "pdf"]) }),
      audit: "employees.data_export",
    },
    async ({ tx, tenantId, audit }, input) => {
      const [e] = await tx
        .select()
        .from(schema.employees)
        .where(eq(schema.employees.id, input.employeeId));
      if (!e) throw new RuleError("not_found");
      const [tenant] = await tx.select().from(schema.tenants);
      const [bank] = await tx
        .select()
        .from(schema.employeeBankDetails)
        .where(eq(schema.employeeBankDetails.employeeId, e.id));
      const field = (table: string, column: string, value: string | null | undefined) =>
        value ? decryptField(keyring, { tenantId, table, column, rowId: e.id }, value) : null;

      const loans = await tx
        .select()
        .from(schema.employeeLoans)
        .where(eq(schema.employeeLoans.employeeId, e.id))
        .orderBy(asc(schema.employeeLoans.createdAt));
      const loanRepayments = loans.length
        ? await tx
            .select({
              loanId: schema.loanRepayments.loanId,
              amount: schema.loanRepayments.amount,
              year: schema.payPeriods.year,
              month: schema.payPeriods.month,
            })
            .from(schema.loanRepayments)
            .innerJoin(schema.payPeriods, eq(schema.payPeriods.id, schema.loanRepayments.periodId))
            .where(
              inArray(
                schema.loanRepayments.loanId,
                loans.map((l) => l.id),
              ),
            )
            .orderBy(asc(schema.payPeriods.year), asc(schema.payPeriods.month))
        : [];

      const slips = await tx
        .select({
          id: schema.payslips.id,
          year: schema.payPeriods.year,
          month: schema.payPeriods.month,
          status: schema.payslips.status,
          periodStatus: schema.payPeriods.status,
          gross: schema.payslips.gross,
          netPay: schema.payslips.netPay,
          employerCost: schema.payslips.employerCost,
        })
        .from(schema.payslips)
        .innerJoin(schema.payPeriods, eq(schema.payPeriods.id, schema.payslips.periodId))
        .where(eq(schema.payslips.employeeId, e.id))
        .orderBy(asc(schema.payPeriods.year), asc(schema.payPeriods.month));
      const lines = slips.length
        ? await tx
            .select({
              payslipId: schema.payslipLines.payslipId,
              code: schema.payslipLines.code,
              label: schema.payslipLines.label,
              amount: schema.payslipLines.amount,
            })
            .from(schema.payslipLines)
            .where(
              inArray(
                schema.payslipLines.payslipId,
                slips.map((s) => s.id),
              ),
            )
            .orderBy(asc(schema.payslipLines.position))
        : [];
      const docs = slips.length
        ? await tx
            .select({
              payslipId: schema.documents.payslipId,
              kind: schema.documents.kind,
              issuedAt: schema.documents.issuedAt,
              sha256: schema.documents.sha256,
              code: schema.documents.verificationCode,
            })
            .from(schema.documents)
            .where(
              inArray(
                schema.documents.payslipId,
                slips.map((s) => s.id),
              ),
            )
        : [];
      const variables = await tx
        .select({
          periodId: schema.payVariables.periodId,
          key: schema.payVariables.key,
          value: schema.payVariables.value,
        })
        .from(schema.payVariables)
        .where(eq(schema.payVariables.employeeId, e.id));
      // Traces d'audit concernant cette fiche (déjà masquées à l'écriture).
      const auditTrail = await tx
        .select({
          action: schema.auditLog.action,
          at: schema.auditLog.createdAt,
          actor: schema.auditLog.actorUserId,
        })
        .from(schema.auditLog)
        .where(and(eq(schema.auditLog.entityType, "employee"), eq(schema.auditLog.entityId, e.id)))
        .orderBy(asc(schema.auditLog.createdAt));

      const data = {
        exportedAt: new Date().toISOString(),
        controller: { legalName: tenant?.legalName, niu: tenant?.niu },
        processor: "PaieCam (sous-traitant au sens de la loi n° 2024/017)",
        employee: {
          matricule: e.matricule,
          lastName: e.lastName,
          firstNames: e.firstNames,
          birthDate: e.birthDate,
          cnpsNumber: field("employees", "cnps_number", e.cnpsNumberEnc),
          hireDate: e.hireDate,
          endDate: e.endDate,
          contractType: e.contractType,
          jobTitle: e.jobTitle,
          category: e.category,
          echelon: e.echelon,
          baseSalary: e.baseSalary,
          maritalStatus: e.maritalStatus,
          childrenCount: e.childrenCount,
          paymentMethod: e.paymentMethod,
          payslipLanguage: e.payslipLanguage,
          archivedAt: e.archivedAt,
          createdAt: e.createdAt,
          updatedAt: e.updatedAt,
        },
        paymentDetails: bank
          ? {
              iban: field("employee_bank_details", "iban", bank.ibanEnc),
              mobileOperator: bank.mobileOperator,
              mobileNumber: field("employee_bank_details", "mobile_number", bank.mobileNumberEnc),
              updatedAt: bank.updatedAt,
            }
          : null,
        payslips: slips.map((s) => ({
          period: `${s.year}-${pad(s.month)}`,
          status: s.status,
          periodStatus: s.periodStatus,
          gross: s.gross,
          netPay: s.netPay,
          employerCost: s.employerCost,
          lines: lines
            .filter((l) => l.payslipId === s.id)
            .map(({ code, label, amount: a }) => ({ code, label, amount: a })),
          documents: docs
            .filter((d) => d.payslipId === s.id)
            .map(({ kind, issuedAt, sha256, code }) => ({
              kind,
              issuedAt,
              sha256,
              verificationCode: code,
            })),
        })),
        loansAndAdvances: loans.map((l) => ({
          kind: l.kind,
          label: l.label,
          principal: l.principal,
          installment: l.installment,
          grantedOn: l.grantedOn,
          start: `${l.startYear}-${pad(l.startMonth)}`,
          status: l.status,
          repayments: loanRepayments
            .filter((r) => r.loanId === l.id)
            .map((r) => ({ period: `${r.year}-${pad(r.month)}`, amount: r.amount })),
        })),
        monthlyVariables: variables,
        auditTrail,
      };
      audit({ entityType: "employee", entityId: e.id, after: { format: input.format } });
      const base = `donnees-salarie-${e.matricule}-${data.exportedAt.slice(0, 10)}`;

      if (input.format === "json") {
        return {
          file: Buffer.from(JSON.stringify(data, null, 2), "utf8"),
          filename: `${base}.json`,
          contentType: "application/json",
        };
      }
      const sections: DataExportSection[] = [
        {
          title: "Identité et contrat",
          fields: [
            ["Matricule", e.matricule],
            ["Nom et prénoms", `${e.lastName} ${e.firstNames}`],
            ["Date de naissance", e.birthDate],
            ["N° CNPS", data.employee.cnpsNumber ?? "non renseigné"],
            ["Embauche / fin", `${e.hireDate} / ${e.endDate ?? "—"}`],
            ["Contrat, poste", `${e.contractType.toUpperCase()}, ${e.jobTitle}`],
            ["Catégorie / échelon", `${e.category} / ${e.echelon}`],
            ["Salaire de base", amount(e.baseSalary)],
            ["Situation familiale, enfants", `${e.maritalStatus}, ${e.childrenCount}`],
          ],
        },
        {
          title: "Coordonnées de paiement",
          fields: [
            ["Mode de paiement", e.paymentMethod],
            ["IBAN", data.paymentDetails?.iban ?? "non renseigné"],
            [
              "Mobile money",
              data.paymentDetails?.mobileNumber
                ? `${data.paymentDetails.mobileNumber} (${data.paymentDetails.mobileOperator})`
                : "non renseigné",
            ],
          ],
        },
        {
          title: "Bulletins de paie",
          table: {
            headers: ["Période", "État", "Brut", "Net à payer"],
            rows: data.payslips.map((p) => [p.period, p.status, amount(p.gross), amount(p.netPay)]),
          },
          note: "Le détail ligne par ligne figure dans l'export JSON et sur chaque bulletin PDF.",
        },
        {
          title: "Prêts et avances",
          table: {
            headers: ["Libellé", "Montant", "Remboursé", "État"],
            rows: data.loansAndAdvances.map((l) => [
              `${l.label} (${l.kind === "loan" ? "prêt" : "avance"}, ${l.grantedOn})`,
              amount(l.principal),
              amount(l.repayments.reduce((s, r) => s + r.amount, 0)),
              l.status,
            ]),
          },
        },
        {
          title: "Historique des opérations sur la fiche",
          table: {
            headers: ["Date", "Opération"],
            rows: auditTrail.map((a) => [
              a.at.toISOString().slice(0, 16).replace("T", " "),
              a.action,
            ]),
          },
        },
      ];
      const file = await renderDataExportPdf({
        title: `Données personnelles — ${e.lastName} ${e.firstNames}`,
        subtitle: `Responsable du traitement : ${tenant?.legalName ?? ""} (NIU ${tenant?.niu ?? ""}). Export du ${data.exportedAt.slice(0, 10)}, établi par PaieCam, sous-traitant.`,
        sections,
      });
      return { file, filename: `${base}.pdf`, contentType: "application/pdf" };
    },
  );
}
