import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDb,
  createTenantWithOwner,
  eq,
  schema,
  sql,
  withUser,
  type NewTenant,
} from "@paiecam/db";
import {
  loadTestRules,
  testBackupDatabaseUrl,
  testDatabaseUrl,
  testRotationDatabaseUrl,
  validateAllTestRules,
} from "@paiecam/db/testing";
import { createFsStorage } from "@paiecam/documents";
import { loadRuleFile } from "@paiecam/paie-engine/rules";
import { parseKeyring } from "@paiecam/security";
import type { RequestContext } from "@/server/authz/action";
import {
  generatePeriodDocuments,
  makeGetPayslipDocument,
  readSignedDownload,
  makeAuthorizeDownload,
  verifyDocumentCode,
} from "@/server/features/documents";
import {
  makeCreateEmployee,
  makeRevealSensitive,
  makeUpdateBankDetails,
} from "@/server/features/employees";
import {
  makeCalculatePeriod,
  makeGetPeriod,
  makeOpenPeriod,
  makeValidatePeriod,
} from "@/server/features/payroll";
import { rotateKeys } from "@/server/features/key-rotation";

const db = createDb(testDatabaseUrl());
const rotationDb = createDb(testRotationDatabaseUrl());
const k1 = `v1:${Buffer.alloc(32, 11).toString("base64")}`;
const k2 = `v2:${Buffer.alloc(32, 12).toString("base64")}`;
const v1 = parseKeyring(k1);
const both = parseKeyring(`${k2},${k1}`);
/** Après rotation, l'ancienne clé est retirée : tout doit fonctionner avec la seule clé v2. */
const v2only = parseKeyring(k2);
const root = mkdtempSync(join(tmpdir(), "paiecam-rotation-"));
const store = (keyring: typeof v1) => createFsStorage(root, keyring);

const fake = (n: string): NewTenant => ({
  legalName: `Garage fictif ${n}`,
  niu: `R0000000000${n}`,
  cnpsEmployerNumber: `000-000000-${n}`,
  regime: "general",
  workAccidentRate: 175,
  commune: "Bafoussam 1er",
});
const U = { a: "rot-owner-a", b: "rot-owner-b" };
const T = { A: "", B: "" };
const emp = { A: "", B: "" };
const ctx = (userId: string, tenantId: string): RequestContext => ({
  user: { id: userId, twoFactorEnabled: true },
  tenantId,
  ip: "203.0.113.70",
  userAgent: "vitest",
});
const ok = <T>(r: { ok: true; data: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.data;
};
const employee = (matricule: string, cnpsNumber: string) => ({
  matricule,
  lastName: "FICTIF",
  firstNames: "Paul",
  birthDate: "1988-02-02",
  cnpsNumber,
  hireDate: "2024-01-15",
  contractType: "cdi",
  endDate: "",
  jobTitle: "Mécanicien",
  category: "5",
  echelon: "A",
  baseSalary: "300000",
  maritalStatus: "single",
  childrenCount: "0",
  paymentMethod: "bank_transfer",
});

/** Un salarié avec n° CNPS et IBAN, et un bulletin définitif, le tout chiffré avec la clé v1. */
async function tenantWithPayslip(key: "A" | "B", user: string, cnps: string) {
  T[key] = await withUser(db, user, (tx) => createTenantWithOwner(tx, user, fake(key)));
  emp[key] = ok(await makeCreateEmployee(db, v1)(ctx(user, T[key]), employee(`${key}-1`, cnps))).id;
  ok(
    await makeUpdateBankDetails(db, { keyring: v1, verifyPassword: async () => true })(
      ctx(user, T[key]),
      { id: emp[key], password: "x", bank: { iban: "CM2110002000300277976315008" } },
    ),
  );
  const periodId = ok(
    await makeOpenPeriod(db)(ctx(user, T[key]), { year: 2026, month: 6 }),
  ).periodId;
  ok(await makeCalculatePeriod(db, { allowDraftRules: false })(ctx(user, T[key]), { periodId }));
  ok(
    await makeValidatePeriod(db, { verifyPassword: async () => true })(ctx(user, T[key]), {
      periodId,
      password: "x",
    }),
  );
  await generatePeriodDocuments(
    db,
    { keyring: v1, storage: store(v1), baseURL: "http://localhost:3000" },
    { tenantId: T[key], periodId },
  );
  const payslipId =
    ok(await makeGetPeriod(db)(ctx(user, T[key]), { periodId })).payslips[0]?.id ?? "";
  return ok(await makeGetPayslipDocument(db)(ctx(user, T[key]), { payslipId }));
}

let docA: Awaited<ReturnType<typeof tenantWithPayslip>>;
let docB: Awaited<ReturnType<typeof tenantWithPayslip>>;

beforeAll(async () => {
  await loadTestRules(
    loadRuleFile(
      new URL("../../../packages/paie-engine/rules/cm-2026.draft.json", import.meta.url).pathname,
    ),
  );
  await validateAllTestRules();
  await db
    .insert(schema.users)
    .values(Object.values(U).map((id) => ({ id, name: id, email: `${id}@exemple.test` })));
  docA = await tenantWithPayslip("A", U.a, "111222333");
  docB = await tenantWithPayslip("B", U.b, "444555666");
  // Le document de B est falsifié en base : sa signature ne correspond plus.
  await rotationDb
    .update(schema.documents)
    .set({ signature: "v1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" })
    .where(eq(schema.documents.verificationCode, docB?.code ?? ""));
}, 60_000);

afterAll(async () => {
  await db.$client.end();
  await rotationDb.$client.end();
});

const rotate = (dryRun: boolean) =>
  rotateKeys(rotationDb, { keyring: both, storage: store(both) }, { dryRun });

describe("rotation des clés", () => {
  it("simulation : compte sans rien modifier et signale le document falsifié", async () => {
    const r = await rotate(true);
    expect(r).toMatchObject({ keyId: "v2", employees: 2, bankDetails: 2, documents: 1, files: 0 });
    expect(r.failures).toEqual([
      { kind: "document", id: expect.any(String), reason: "signature actuelle invalide" },
    ]);
    const [row] = await rotationDb
      .select({ enc: schema.employees.cnpsNumberEnc })
      .from(schema.employees)
      .where(eq(schema.employees.id, emp.A));
    expect(row?.enc).toMatch(/^v1\./);
  });

  it("applique : tout passe à la clé v2, sauf le document falsifié, jamais re-signé", async () => {
    const r = await rotate(false);
    expect(r).toMatchObject({ employees: 2, bankDetails: 2, documents: 1, files: 1 });
    expect(r.failures).toHaveLength(1);
    const [b] = await rotationDb
      .select({ signature: schema.documents.signature })
      .from(schema.documents)
      .where(eq(schema.documents.verificationCode, docB?.code ?? ""));
    expect(b?.signature).toMatch(/^v1\.AAAA/);
  });

  it("relançable : une seconde exécution ne trouve plus rien à faire", async () => {
    const r = await rotate(false);
    expect(r).toMatchObject({ employees: 0, bankDetails: 0, documents: 0, files: 0 });
    expect(r.failures).toHaveLength(1);
  });

  it("l'ancienne clé retirée, les données restent lisibles et les documents vérifiables", async () => {
    expect(ok(await makeRevealSensitive(db, v2only)(ctx(U.a, T.A), { id: emp.A }))).toMatchObject({
      cnpsNumber: "111222333",
      iban: "CM2110002000300277976315008",
    });
    expect(await verifyDocumentCode(db, v2only, docA?.code ?? "")).toMatchObject({
      signatureValid: true,
    });
    const link = ok(
      await makeAuthorizeDownload(db, v2only)(ctx(U.a, T.A), { documentId: docA?.id ?? "" }),
    );
    const file = await readSignedDownload(
      db,
      { keyring: v2only, storage: store(v2only) },
      link.token,
    );
    expect(file?.pdf.subarray(0, 5).toString()).toBe("%PDF-");
    // Le document falsifié reste invalide.
    expect(await verifyDocumentCode(db, v2only, docB?.code ?? "")).toMatchObject({
      signatureValid: false,
    });
  });

  it("les empreintes sont recalculées : un doublon de n° CNPS reste détecté", async () => {
    const dup = await makeCreateEmployee(db, v2only)(ctx(U.a, T.A), employee("A-2", "111222333"));
    expect(dup.ok).toBe(false);
  });

  it("la rotation est tracée hors entreprise, avec des compteurs seulement", async () => {
    const reader = createDb(testBackupDatabaseUrl());
    try {
      const rows = await reader
        .select({ tenantId: schema.auditLog.tenantId, after: schema.auditLog.after })
        .from(schema.auditLog)
        .where(eq(schema.auditLog.action, "security.key_rotation"))
        .orderBy(schema.auditLog.id);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({
        tenantId: null,
        after: { keyId: "v2", employees: 2, bankDetails: 2, documents: 1, files: 1, failures: 1 },
      });
    } finally {
      await reader.$client.end();
    }
  });
});

describe("rôle de rotation", () => {
  it("ne lit ni ne modifie aucune donnée en clair", async () => {
    const denied = async (q: Promise<unknown>) => {
      try {
        await q;
        return "autorisé";
      } catch (e) {
        return (e as Error & { cause?: Error }).cause?.message ?? (e as Error).message;
      }
    };
    expect(await denied(rotationDb.execute(sql`select last_name from employees`))).toMatch(
      /permission denied/,
    );
    expect(await denied(rotationDb.execute(sql`update employees set base_salary = 0`))).toMatch(
      /permission denied/,
    );
    expect(await denied(rotationDb.execute(sql`select * from tenants`))).toMatch(
      /permission denied/,
    );
    expect(await denied(rotationDb.execute(sql`select ip from audit_log`))).toMatch(
      /permission denied/,
    );
  });
});
