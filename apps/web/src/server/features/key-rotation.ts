/**
 * Rotation des clés de chiffrement : après avoir placé une nouvelle clé en tête de
 * FIELD_ENCRYPTION_KEYS, rechiffre les champs, recalcule les empreintes, rechiffre les fichiers et
 * signe à nouveau les documents avec la clé courante. Quand plus rien n'utilise l'ancienne clé,
 * elle peut être retirée du trousseau.
 *
 * Exécuté avec le rôle paiecam_rotation (colonnes chiffrées uniquement). Relançable : seules les
 * valeurs encore liées à une ancienne clé sont traitées, et chaque écriture est conditionnée à la
 * valeur lue (aucune modification concurrente écrasée).
 */
import { and, asc, eq, gt, schema, sql, type Db } from "@paiecam/db";
import { signedMessage, type DocumentStorage } from "@paiecam/documents";
import {
  blindIndex,
  decryptField,
  encryptField,
  signMessage,
  verifySignature,
  type Keyring,
} from "@paiecam/security";

export interface RotationReport {
  keyId: string;
  dryRun: boolean;
  /** Valeurs (ou documents) traitées, ou à traiter en simulation. */
  employees: number;
  bankDetails: number;
  documents: number;
  files: number;
  /** Éléments non traités : à examiner (aucune donnée personnelle, seulement des identifiants). */
  failures: { kind: "employee" | "bank_details" | "document"; id: string; reason: string }[];
}

const BATCH = 200;
const { employees, employeeBankDetails: bank, documents, auditLog } = schema;

/** Valeur liée à une autre clé que la clé courante (préfixe « <kid>. »). */
const old = (kid: string, column: Parameters<typeof sql>[1]) =>
  sql`(${column} is not null and ${column} not like ${`${kid}.%`})`;

export async function rotateKeys(
  db: Db,
  deps: { keyring: Keyring; storage: DocumentStorage },
  options: { dryRun: boolean },
): Promise<RotationReport> {
  const { keyring, storage } = deps;
  const kid = keyring.currentId;
  const report: RotationReport = {
    keyId: kid,
    dryRun: options.dryRun,
    employees: 0,
    bankDetails: 0,
    documents: 0,
    files: 0,
    failures: [],
  };

  // N° CNPS chiffré et son empreinte (recalculée : la détection des doublons en dépend).
  for (let after = ""; ;) {
    const rows = await db
      .select({
        id: employees.id,
        tenantId: employees.tenantId,
        enc: employees.cnpsNumberEnc,
        index: employees.cnpsNumberIndex,
      })
      .from(employees)
      .where(
        and(
          gt(employees.id, after || "00000000-0000-0000-0000-000000000000"),
          sql`(${old(kid, employees.cnpsNumberEnc)} or ${old(kid, employees.cnpsNumberIndex)})`,
        ),
      )
      .orderBy(asc(employees.id))
      .limit(BATCH);
    if (rows.length === 0) break;
    after = rows.at(-1)?.id ?? after;
    for (const r of rows) {
      if (!r.enc) continue;
      if (options.dryRun) {
        report.employees++;
        continue;
      }
      try {
        const ctx = {
          tenantId: r.tenantId,
          table: "employees",
          column: "cnps_number",
          rowId: r.id,
        };
        const cnps = decryptField(keyring, ctx, r.enc);
        const updated = await db
          .update(employees)
          .set({
            cnpsNumberEnc: encryptField(keyring, ctx, cnps),
            cnpsNumberIndex: blindIndex(keyring, r.tenantId, "cnps", cnps),
          })
          .where(and(eq(employees.id, r.id), eq(employees.cnpsNumberEnc, r.enc)))
          .returning({ id: employees.id });
        if (updated.length === 1) report.employees++;
        else
          report.failures.push({
            kind: "employee",
            id: r.id,
            reason: "modifié pendant la rotation",
          });
      } catch {
        report.failures.push({ kind: "employee", id: r.id, reason: "déchiffrement impossible" });
      }
    }
  }

  // Coordonnées de paiement.
  for (let after = ""; ;) {
    const rows = await db
      .select({
        id: bank.id,
        tenantId: bank.tenantId,
        employeeId: bank.employeeId,
        iban: bank.ibanEnc,
        mobile: bank.mobileNumberEnc,
      })
      .from(bank)
      .where(
        and(
          gt(bank.id, after || "00000000-0000-0000-0000-000000000000"),
          sql`(${old(kid, bank.ibanEnc)} or ${old(kid, bank.mobileNumberEnc)})`,
        ),
      )
      .orderBy(asc(bank.id))
      .limit(BATCH);
    if (rows.length === 0) break;
    after = rows.at(-1)?.id ?? after;
    for (const r of rows) {
      if (options.dryRun) {
        report.bankDetails++;
        continue;
      }
      try {
        const ctx = (column: "iban" | "mobile_number") => ({
          tenantId: r.tenantId,
          table: "employee_bank_details",
          column,
          rowId: r.employeeId,
        });
        const again = (column: "iban" | "mobile_number", v: string | null) =>
          v === null
            ? null
            : encryptField(keyring, ctx(column), decryptField(keyring, ctx(column), v));
        const updated = await db
          .update(bank)
          .set({
            ibanEnc: again("iban", r.iban),
            mobileNumberEnc: again("mobile_number", r.mobile),
          })
          .where(
            and(
              eq(bank.id, r.id),
              sql`${bank.ibanEnc} is not distinct from ${r.iban}`,
              sql`${bank.mobileNumberEnc} is not distinct from ${r.mobile}`,
            ),
          )
          .returning({ id: bank.id });
        if (updated.length === 1) report.bankDetails++;
        else
          report.failures.push({
            kind: "bank_details",
            id: r.id,
            reason: "modifié pendant la rotation",
          });
      } catch {
        report.failures.push({
          kind: "bank_details",
          id: r.id,
          reason: "déchiffrement impossible",
        });
      }
    }
  }

  // Documents : fichier rechiffré, puis signature renouvelée. Une signature déjà invalide n'est
  // JAMAIS renouvelée : ce serait authentifier un document peut-être falsifié.
  for (let after = ""; ;) {
    const rows = await db
      .select({
        id: documents.id,
        storageKey: documents.storageKey,
        sha256: documents.sha256,
        issuedAt: documents.issuedAt,
        code: documents.verificationCode,
        signature: documents.signature,
      })
      .from(documents)
      .where(
        and(
          gt(documents.id, after || "00000000-0000-0000-0000-000000000000"),
          old(kid, documents.signature),
        ),
      )
      .orderBy(asc(documents.id))
      .limit(BATCH);
    if (rows.length === 0) break;
    after = rows.at(-1)?.id ?? after;
    for (const r of rows) {
      const message = signedMessage(r.sha256, r.issuedAt.toISOString(), r.code);
      if (!verifySignature(keyring, message, r.signature)) {
        report.failures.push({ kind: "document", id: r.id, reason: "signature actuelle invalide" });
        continue;
      }
      if (options.dryRun) {
        report.documents++;
        continue;
      }
      try {
        if ((await storage.reencrypt(r.storageKey)) === "rewritten") report.files++;
      } catch {
        report.failures.push({ kind: "document", id: r.id, reason: "fichier illisible ou absent" });
        continue;
      }
      const updated = await db
        .update(documents)
        .set({ signature: signMessage(keyring, message) })
        .where(and(eq(documents.id, r.id), eq(documents.signature, r.signature)))
        .returning({ id: documents.id });
      if (updated.length === 1) report.documents++;
      else
        report.failures.push({ kind: "document", id: r.id, reason: "modifié pendant la rotation" });
    }
  }

  if (!options.dryRun) {
    await db.insert(auditLog).values({
      tenantId: null,
      actorUserId: null,
      action: "security.key_rotation",
      after: {
        keyId: kid,
        employees: report.employees,
        bankDetails: report.bankDetails,
        documents: report.documents,
        files: report.files,
        failures: report.failures.length,
      },
    });
  }
  return report;
}
