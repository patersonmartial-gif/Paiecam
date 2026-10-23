import { z } from "zod";
import { and, asc, eq, inArray, lte, schema, sql, withTenant, type Db, type Tx } from "@paiecam/db";
import {
  newVerificationCode,
  renderPayslipPdf,
  sha256Hex,
  signedMessage,
  type DocumentStorage,
  type Lang,
  type PayslipPdfData,
} from "@paiecam/documents";
import { decryptField, signMessage, verifySignature, type Keyring } from "@paiecam/security";
import { createTenantAction, RuleError } from "../authz/action";
import { can } from "../authz/permissions";

/** Identité technique des tâches de fond dans le contexte RLS (aucun droit utilisateur). */
export const SYSTEM_USER = "system:documents";
export const PREVIEW_WATERMARK = "APERÇU — PROVISOIRE";

type Snapshot = {
  matricule: string;
  lastName: string;
  firstNames: string;
  jobTitle: string;
  category: string;
  echelon: string;
  hireDate: string;
  contractType: string;
  cnpsNumberLast4: string | null;
  language: Lang;
};

/** Données d'un bulletin pour le PDF. Le n° CNPS n'est en clair que si `fullCnps`. */
async function buildPdfData(
  tx: Tx,
  keyring: Keyring,
  payslipId: string,
  fullCnps: boolean,
): Promise<{
  data: PayslipPdfData;
  periodStatus: string;
  slipStatus: string;
  period: { year: number; month: number };
}> {
  const [slip] = await tx.select().from(schema.payslips).where(eq(schema.payslips.id, payslipId));
  if (!slip) throw new RuleError("not_found");
  const [period] = await tx
    .select()
    .from(schema.payPeriods)
    .where(eq(schema.payPeriods.id, slip.periodId));
  const [tenant] = await tx.select().from(schema.tenants);
  const [employee] = await tx
    .select()
    .from(schema.employees)
    .where(eq(schema.employees.id, slip.employeeId));
  if (!period || !tenant || !employee) throw new RuleError("not_found");
  const lines = await tx
    .select()
    .from(schema.payslipLines)
    .where(eq(schema.payslipLines.payslipId, slip.id))
    .orderBy(asc(schema.payslipLines.position));
  const items = await tx
    .select({ code: schema.payItems.code, en: schema.payItems.labelEn })
    .from(schema.payItems);
  const snap = slip.employeeSnapshot as Snapshot;
  const totals = slip.totals as {
    netTaxableMonthly: number;
    employeeContributions: number;
    deductions: number;
  };

  // Cumuls de l'année : mois validés ou verrouillés de la même année jusqu'à ce mois, plus ce bulletin.
  const earlier = await tx
    .select({ gross: schema.payslips.gross, net: schema.payslips.netPay, id: schema.payslips.id })
    .from(schema.payslips)
    .innerJoin(schema.payPeriods, eq(schema.payPeriods.id, schema.payslips.periodId))
    .where(
      and(
        eq(schema.payslips.employeeId, slip.employeeId),
        eq(schema.payPeriods.year, period.year),
        lte(schema.payPeriods.month, period.month - 1),
        inArray(schema.payPeriods.status, ["validated", "locked"]),
      ),
    );
  const earlierIrpp = earlier.length
    ? await tx
        .select({ amount: sql<number>`coalesce(sum(${schema.payslipLines.amount}), 0)::int` })
        .from(schema.payslipLines)
        .where(
          and(
            inArray(
              schema.payslipLines.payslipId,
              earlier.map((e) => e.id),
            ),
            eq(schema.payslipLines.code, "irpp"),
          ),
        )
    : [{ amount: 0 }];
  const irpp = lines.find((l) => l.code === "irpp")?.amount ?? 0;

  let cnpsNumber: string | null = null;
  if (employee.cnpsNumberEnc) {
    cnpsNumber = fullCnps
      ? decryptField(
          keyring,
          { tenantId: tenant.id, table: "employees", column: "cnps_number", rowId: employee.id },
          employee.cnpsNumberEnc,
        )
      : `•••• ${employee.cnpsNumberLast4 ?? ""}`;
  }

  return {
    period: { year: period.year, month: period.month },
    periodStatus: period.status,
    slipStatus: slip.status,
    data: {
      language: employee.payslipLanguage,
      employer: {
        legalName: tenant.legalName,
        niu: tenant.niu,
        cnpsEmployerNumber: tenant.cnpsEmployerNumber,
        commune: tenant.commune,
      },
      employee: { ...snap, cnpsNumber },
      period: { year: period.year, month: period.month },
      lines: lines.map((l) => ({
        code: l.code,
        label: l.label,
        section: l.section,
        // Sur le bulletin, l'IRPP s'affiche sur le revenu net imposable du mois (pas la base annuelle).
        base: l.code === "irpp" ? totals.netTaxableMonthly : l.base,
        rate: l.rate,
        amount: l.amount,
      })),
      totals: {
        gross: slip.gross,
        employeeContributions: totals.employeeContributions,
        deductions: totals.deductions,
        netPay: slip.netPay,
        employerCost: slip.employerCost,
      },
      ytd: {
        gross: earlier.reduce((s, e) => s + e.gross, 0) + slip.gross,
        irpp: (earlierIrpp[0]?.amount ?? 0) + irpp,
        netPay: earlier.reduce((s, e) => s + e.net, 0) + slip.netPay,
      },
      itemLabelsEn: Object.fromEntries(items.map((i) => [i.code, i.en])),
    },
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Génère et archive les PDF définitifs d'un mois validé (tâche de fond).
 * Relançable sans effet de bord : un bulletin qui a déjà son document est ignoré.
 */
export async function generatePeriodDocuments(
  db: Db,
  deps: { keyring: Keyring; storage: DocumentStorage; baseURL: string },
  job: { tenantId: string; periodId: string },
): Promise<{ generated: number; skipped: number }> {
  return withTenant(db, { tenantId: job.tenantId, userId: SYSTEM_USER }, async (tx) => {
    const [period] = await tx
      .select()
      .from(schema.payPeriods)
      .where(eq(schema.payPeriods.id, job.periodId));
    if (!period || (period.status !== "validated" && period.status !== "locked"))
      throw new Error("période non validée");
    const [tenant] = await tx.select().from(schema.tenants);
    const slips = await tx
      .select({ id: schema.payslips.id })
      .from(schema.payslips)
      .where(eq(schema.payslips.periodId, period.id));
    const existing = new Set(
      slips.length === 0
        ? []
        : (
            await tx
              .select({ p: schema.documents.payslipId })
              .from(schema.documents)
              .where(
                inArray(
                  schema.documents.payslipId,
                  slips.map((s) => s.id),
                ),
              )
          ).map((d) => d.p),
    );
    let generated = 0;
    for (const { id } of slips) {
      if (existing.has(id)) continue;
      const { data } = await buildPdfData(tx, deps.keyring, id, true);
      const code = newVerificationCode();
      const pdf = await renderPayslipPdf(data, {
        verification: { code, url: `${deps.baseURL}/verifier/${code}` },
      });
      const sha256 = sha256Hex(pdf);
      const issuedAt = new Date();
      const storageKey = `${job.tenantId}/${period.year}-${pad(period.month)}/${id}.pdf`;
      await deps.storage.put(storageKey, pdf);
      await tx.insert(schema.documents).values({
        tenantId: job.tenantId,
        payslipId: id,
        kind: "payslip_pdf",
        language: data.language,
        issuerName: tenant?.legalName ?? "",
        periodYear: period.year,
        periodMonth: period.month,
        storageKey,
        sizeBytes: pdf.length,
        sha256,
        signature: signMessage(deps.keyring, signedMessage(sha256, issuedAt.toISOString(), code)),
        verificationCode: code,
        issuedAt,
      });
      generated++;
    }
    await tx.insert(schema.auditLog).values({
      tenantId: job.tenantId,
      actorUserId: SYSTEM_USER,
      action: "documents.generate",
      entityType: "pay_period",
      entityId: period.id,
      after: { generated, skipped: existing.size },
    });
    return { generated, skipped: existing.size };
  });
}

/** Aperçu PDF d'un bulletin calculé : filigrané tant que le mois n'est pas validé, jamais stocké. */
export function makePreviewPayslipPdf(db: Db, keyring: Keyring) {
  return createTenantAction(
    db,
    {
      permission: "payroll:read",
      input: z.object({ payslipId: z.uuid() }),
      audit: "documents.preview",
    },
    async ({ tx, role, audit }, input) => {
      // Le n° CNPS complet n'apparaît que pour les rôles autorisés à le voir en clair.
      const built = await buildPdfData(
        tx,
        keyring,
        input.payslipId,
        can(role, "employees:sensitive"),
      );
      const final = built.periodStatus === "validated" || built.periodStatus === "locked";
      const pdf = await renderPayslipPdf(built.data, final ? {} : { watermark: PREVIEW_WATERMARK });
      audit({ entityType: "payslip", entityId: input.payslipId });
      return {
        pdf,
        filename: `apercu-bulletin-${built.period.year}-${pad(built.period.month)}-${built.data.employee.matricule}.pdf`,
      };
    },
  );
}

/** Métadonnées du document définitif d'un bulletin (pour l'affichage et le téléchargement). */
export function makeGetPayslipDocument(db: Db) {
  return createTenantAction(
    db,
    {
      permission: "payroll:read",
      input: z.object({ payslipId: z.uuid() }),
      audit: "documents.read",
      skipAudit: true,
    },
    async ({ tx }, input) => {
      const [doc] = await tx
        .select({
          id: schema.documents.id,
          code: schema.documents.verificationCode,
          issuedAt: schema.documents.issuedAt,
        })
        .from(schema.documents)
        .where(eq(schema.documents.payslipId, input.payslipId));
      return doc ?? null;
    },
  );
}

/** Durée de validité d'un lien de téléchargement. */
export const DOWNLOAD_TTL_SECONDS = 5 * 60;
const downloadMessage = (documentId: string, tenantId: string, exp: number) =>
  `download|${documentId}|${tenantId}|${exp}`;

/** Autorise un téléchargement (droits vérifiés, audité) et renvoie un jeton signé valable 5 minutes. */
export function makeAuthorizeDownload(db: Db, keyring: Keyring) {
  return createTenantAction(
    db,
    {
      permission: "payroll:read",
      input: z.object({ documentId: z.uuid() }),
      audit: "documents.download",
    },
    async ({ tx, tenantId, audit }, input) => {
      const [doc] = await tx
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(eq(schema.documents.id, input.documentId));
      if (!doc) throw new RuleError("not_found");
      const exp = Math.floor(Date.now() / 1000) + DOWNLOAD_TTL_SECONDS;
      audit({ entityType: "document", entityId: doc.id });
      return {
        token: `${doc.id}.${tenantId}.${exp}.${signMessage(keyring, downloadMessage(doc.id, tenantId, exp))}`,
      };
    },
  );
}

/** Vérifie un jeton de téléchargement et renvoie le PDF déchiffré. */
export async function readSignedDownload(
  db: Db,
  deps: { keyring: Keyring; storage: DocumentStorage },
  token: string,
  now = Date.now(),
): Promise<{ pdf: Buffer; filename: string } | null> {
  const [documentId, tenantId, expRaw, ...sig] = token.split(".");
  const exp = Number(expRaw);
  if (!documentId || !tenantId || !Number.isSafeInteger(exp) || sig.length !== 2) return null;
  if (exp * 1000 < now) return null;
  if (!verifySignature(deps.keyring, downloadMessage(documentId, tenantId, exp), sig.join(".")))
    return null;
  const doc = await withTenant(db, { tenantId, userId: SYSTEM_USER }, async (tx) => {
    const [d] = await tx.select().from(schema.documents).where(eq(schema.documents.id, documentId));
    return d;
  });
  if (!doc) return null;
  const pdf = await deps.storage.get(doc.storageKey);
  if (sha256Hex(pdf) !== doc.sha256) throw new Error("document altéré dans le stockage");
  return {
    pdf,
    filename: `bulletin-${doc.periodYear}-${pad(doc.periodMonth)}-${doc.id.slice(0, 8)}.pdf`,
  };
}

export interface VerificationResult {
  issuerName: string;
  periodYear: number;
  periodMonth: number;
  issuedAt: Date;
  sha256: string;
  signatureValid: boolean;
}

/** Vérification publique par code : ne révèle que l'émetteur, la période, la date et l'empreinte. */
export async function verifyDocumentCode(
  db: Db,
  keyring: Keyring,
  code: string,
): Promise<VerificationResult | null> {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/.test(normalized)) return null;
  const doc = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.document_code', ${normalized}, true)`);
    const [d] = await tx
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.verificationCode, normalized));
    return d;
  });
  if (!doc) return null;
  return {
    issuerName: doc.issuerName,
    periodYear: doc.periodYear,
    periodMonth: doc.periodMonth,
    issuedAt: doc.issuedAt,
    sha256: doc.sha256,
    signatureValid: verifySignature(
      keyring,
      signedMessage(doc.sha256, doc.issuedAt.toISOString(), doc.verificationCode),
      doc.signature,
    ),
  };
}
