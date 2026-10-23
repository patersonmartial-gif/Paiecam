import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PDFParse } from "pdf-parse";
import {
  createDb,
  createTenantWithOwner,
  schema,
  withTenant,
  withUser,
  type NewTenant,
} from "@paiecam/db";
import { loadTestRules, testDatabaseUrl, validateAllTestRules } from "@paiecam/db/testing";
import { createFsStorage } from "@paiecam/documents";
import { loadRuleFile } from "@paiecam/paie-engine/rules";
import { encryptBlob, parseKeyring } from "@paiecam/security";
import type { RequestContext } from "@/server/authz/action";
import {
  generatePeriodDocuments,
  makeAuthorizeDownload,
  makeGetPayslipDocument,
  makePreviewPayslipPdf,
  readSignedDownload,
  verifyDocumentCode,
} from "@/server/features/documents";
import { makeCreateEmployee } from "@/server/features/employees";
import {
  makeCalculatePeriod,
  makeGetPeriod,
  makeOpenPeriod,
  makeValidatePeriod,
} from "@/server/features/payroll";

const db = createDb(testDatabaseUrl());
const keyring = parseKeyring(`v1:${Buffer.alloc(32, 6).toString("base64")}`);
const root = mkdtempSync(join(tmpdir(), "paiecam-docs-"));
const storage = createFsStorage(root, keyring);
const deps = { keyring, storage, baseURL: "http://localhost:3000" };

const fake = (n: string): NewTenant => ({
  legalName: `Atelier fictif ${n}`,
  niu: `D0000000000${n}`,
  cnpsEmployerNumber: `000-000000-${n}`,
  regime: "general",
  workAccidentRate: 175,
  commune: "Maroua 1er",
});
const U = { owner: "doc-owner", accountant: "doc-accountant", ownerB: "doc-owner-b" };
let A = "";
let B = "";
let period = "";
let payslipId = "";
const ctx = (userId: string, tenantId = A): RequestContext => ({
  user: { id: userId, twoFactorEnabled: true },
  tenantId,
  ip: "203.0.113.60",
  userAgent: "vitest",
});
const ok = <T>(r: { ok: true; data: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.data;
};
async function text(pdf: Buffer) {
  const p = new PDFParse({ data: new Uint8Array(pdf) });
  try {
    return (await p.getText()).text.replace(/\s+/g, " ");
  } finally {
    await p.destroy();
  }
}

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
  A = await withUser(db, U.owner, (tx) => createTenantWithOwner(tx, U.owner, fake("A")));
  B = await withUser(db, U.ownerB, (tx) => createTenantWithOwner(tx, U.ownerB, fake("B")));
  await withTenant(db, { tenantId: A, userId: U.owner }, (tx) =>
    tx.insert(schema.memberships).values({ tenantId: A, userId: U.accountant, role: "accountant" }),
  );
  ok(
    await makeCreateEmployee(db, keyring)(ctx(U.owner), {
      matricule: "D-1",
      lastName: "FICTIF",
      firstNames: "Awa",
      birthDate: "1992-04-04",
      cnpsNumber: "123456789",
      hireDate: "2024-01-15",
      contractType: "cdi",
      endDate: "",
      jobTitle: "Couturière",
      category: "4",
      echelon: "B",
      baseSalary: "400000",
      maritalStatus: "single",
      childrenCount: "0",
      paymentMethod: "cash",
    }),
  );
  period = ok(await makeOpenPeriod(db)(ctx(U.owner), { year: 2026, month: 5 })).periodId;
  ok(await makeCalculatePeriod(db, { allowDraftRules: false })(ctx(U.owner), { periodId: period }));
  payslipId = ok(await makeGetPeriod(db)(ctx(U.owner), { periodId: period })).payslips[0]?.id ?? "";
});

afterAll(async () => {
  await db.$client.end();
});

describe("aperçu", () => {
  it("avant validation : filigrane, et n° CNPS masqué pour le comptable", async () => {
    const owner = ok(await makePreviewPayslipPdf(db, keyring)(ctx(U.owner), { payslipId }));
    const tOwner = await text(owner.pdf);
    expect(tOwner).toContain("APERÇU — PROVISOIRE");
    expect(tOwner).toContain("123456789");
    expect(tOwner).toContain("345 015 FCFA");
    const tAcc = await text(
      ok(await makePreviewPayslipPdf(db, keyring)(ctx(U.accountant), { payslipId })).pdf,
    );
    expect(tAcc).not.toContain("123456789");
    expect(tAcc).toContain("•••• 6789");
  });

  it("anti-IDOR : B ne prévisualise pas un bulletin de A", async () => {
    expect(await makePreviewPayslipPdf(db, keyring)(ctx(U.ownerB, B), { payslipId })).toEqual({
      ok: false,
      error: { code: "RULE", reason: "not_found" },
    });
  });
});

describe("génération des PDF définitifs", () => {
  it("refuse un mois non validé", async () => {
    await expect(
      generatePeriodDocuments(db, deps, { tenantId: A, periodId: period }),
    ).rejects.toThrow(/non validée/);
  });

  it("génère une fois, relançable sans doublon, stocké chiffré", async () => {
    ok(
      await makeValidatePeriod(db, { verifyPassword: async () => true })(ctx(U.owner), {
        periodId: period,
        password: "x",
      }),
    );
    expect(await generatePeriodDocuments(db, deps, { tenantId: A, periodId: period })).toEqual({
      generated: 1,
      skipped: 0,
    });
    expect(await generatePeriodDocuments(db, deps, { tenantId: A, periodId: period })).toEqual({
      generated: 0,
      skipped: 1,
    });
    const doc = ok(await makeGetPayslipDocument(db)(ctx(U.accountant), { payslipId }));
    expect(doc?.code).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
    const [file] = readdirSync(join(root, A, "2026-05"));
    expect(
      (await readFile(join(root, A, "2026-05", file ?? ""))).includes(Buffer.from("%PDF")),
    ).toBe(false);
  });

  it("le PDF définitif : sans filigrane, n° CNPS complet, cumuls, code de vérification", async () => {
    const doc = ok(await makeGetPayslipDocument(db)(ctx(U.owner), { payslipId }));
    const { token } = ok(
      await makeAuthorizeDownload(db, keyring)(ctx(U.accountant), { documentId: doc?.id ?? "" }),
    );
    const file = await readSignedDownload(db, { keyring, storage }, token);
    const t = await text(file?.pdf ?? Buffer.alloc(0));
    expect(t).not.toContain("PROVISOIRE");
    for (const s of [
      "Atelier fictif A",
      "FICTIF Awa",
      "123456789",
      "345 015 FCFA",
      "Cumuls de l'année",
      doc?.code ?? "?",
    ])
      expect(t, s).toContain(s);
    // L'IRPP s'affiche sur le revenu net imposable du mois, pas sur la base annuelle.
    expect(t).toContain("263 200");
    expect(t).not.toContain("2 658 400");
  });
});

describe("téléchargement", () => {
  it("lien signé : valable 5 minutes, infalsifiable", async () => {
    const doc = ok(await makeGetPayslipDocument(db)(ctx(U.owner), { payslipId }));
    const { token } = ok(
      await makeAuthorizeDownload(db, keyring)(ctx(U.owner), { documentId: doc?.id ?? "" }),
    );
    expect(await readSignedDownload(db, { keyring, storage }, token)).not.toBeNull();
    expect(
      await readSignedDownload(db, { keyring, storage }, token, Date.now() + 6 * 60_000),
    ).toBeNull();
    const [id, , exp, ...sig] = token.split(".");
    expect(
      await readSignedDownload(db, { keyring, storage }, [id, B, exp, ...sig].join(".")),
    ).toBeNull();
    expect(
      await readSignedDownload(
        db,
        { keyring, storage },
        [id, A, Number(exp) + 3600, ...sig].join("."),
      ),
    ).toBeNull();
    expect(await readSignedDownload(db, { keyring, storage }, "n.importe.quoi")).toBeNull();
  });

  it("anti-IDOR : B ne peut pas obtenir de lien pour un document de A", async () => {
    const doc = ok(await makeGetPayslipDocument(db)(ctx(U.owner), { payslipId }));
    expect(
      await makeAuthorizeDownload(db, keyring)(ctx(U.ownerB, B), { documentId: doc?.id ?? "" }),
    ).toEqual({
      ok: false,
      error: { code: "RULE", reason: "not_found" },
    });
  });

  it("détecte un fichier remplacé dans le stockage", async () => {
    const doc = ok(await makeGetPayslipDocument(db)(ctx(U.owner), { payslipId }));
    const [row] = await withTenant(db, { tenantId: A, userId: U.owner }, (tx) =>
      tx.select().from(schema.documents),
    );
    // Un faux PDF, correctement chiffré pour cet emplacement, mais différent de l'original.
    writeFileSync(
      join(root, row?.storageKey ?? ""),
      encryptBlob(keyring, row?.storageKey ?? "", Buffer.from("%PDF-faux")),
    );
    const { token } = ok(
      await makeAuthorizeDownload(db, keyring)(ctx(U.owner), { documentId: doc?.id ?? "" }),
    );
    await expect(readSignedDownload(db, { keyring, storage }, token)).rejects.toThrow(/altéré/);
  });
});

describe("vérification publique", () => {
  it("par code : émetteur, période, empreinte et signature, rien sur le salarié", async () => {
    const doc = ok(await makeGetPayslipDocument(db)(ctx(U.owner), { payslipId }));
    const r = await verifyDocumentCode(db, keyring, (doc?.code ?? "").toLowerCase());
    expect(r).toMatchObject({
      issuerName: "Atelier fictif A",
      periodYear: 2026,
      periodMonth: 5,
      signatureValid: true,
    });
    expect(JSON.stringify(r)).not.toMatch(/FICTIF|Awa|345/);
    expect(await verifyDocumentCode(db, keyring, "AAAA-BBBB-CCCC-DDDD")).toBeNull();
    expect(await verifyDocumentCode(db, keyring, "'; drop table documents; --")).toBeNull();
    expect(
      await verifyDocumentCode(
        db,
        parseKeyring(`v1:${Buffer.alloc(32, 1).toString("base64")}`),
        doc?.code ?? "",
      ),
    ).toMatchObject({
      signatureValid: false,
    });
  });
});
