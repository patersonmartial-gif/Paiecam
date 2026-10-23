import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readSheet } from "read-excel-file/node";
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
import { parseKeyring } from "@paiecam/security";
import type { RequestContext } from "@/server/authz/action";
import {
  makeExportJournal,
  makeGenerateDeclarations,
  makeListDeclarations,
  makeLockPeriod,
  makeMarkFiled,
  makeMarkPaid,
} from "@/server/features/declarations";
import { makeAuthorizeDownload, readSignedDownload } from "@/server/features/documents";
import { makeCreateEmployee } from "@/server/features/employees";
import { makeCalculatePeriod, makeOpenPeriod, makeValidatePeriod } from "@/server/features/payroll";

const db = createDb(testDatabaseUrl());
const keyring = parseKeyring(`v1:${Buffer.alloc(32, 2).toString("base64")}`);
const storage = createFsStorage(mkdtempSync(join(tmpdir(), "paiecam-decl-")), keyring);
const generate = makeGenerateDeclarations(db, { keyring, storage });
const list = makeListDeclarations(db);
const filed = makeMarkFiled(db);
const paid = makeMarkPaid(db);
const lock = makeLockPeriod(db);

const fake = (n: string): NewTenant => ({
  legalName: `Clinique fictive ${n}`,
  niu: `K0000000000${n}`,
  cnpsEmployerNumber: `000-000000-${n}`,
  regime: "general",
  workAccidentRate: 175,
  commune: "Douala 5e",
});
const U = { owner: "dc-owner", accountant: "dc-accountant", ownerB: "dc-owner-b" };
let A = "";
let B = "";
let period = "";
const ctx = (userId: string, tenantId = A): RequestContext => ({
  user: { id: userId, twoFactorEnabled: true },
  tenantId,
  ip: null,
  userAgent: null,
});
const ok = <T>(r: { ok: true; data: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.data;
};
const rule = (reason: string) => ({ ok: false, error: { code: "RULE", reason } });
const declarationsOf = async () => ok(await list(ctx(U.owner), { periodId: period }));
const byKind = async (kind: string) => (await declarationsOf()).find((d) => d.kind === kind);

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
  const create = makeCreateEmployee(db, keyring);
  const base = {
    birthDate: "1990-01-01",
    hireDate: "2024-01-15",
    contractType: "cdi",
    endDate: "",
    jobTitle: "Infirmier",
    category: "5",
    echelon: "A",
    maritalStatus: "single",
    childrenCount: "0",
    paymentMethod: "cash",
  };
  ok(
    await create(ctx(U.owner), {
      ...base,
      matricule: "C-1",
      lastName: "FICTIF",
      firstNames: "Un",
      cnpsNumber: "987654321",
      baseSalary: "400000",
    }),
  );
  ok(
    await create(ctx(U.owner), {
      ...base,
      matricule: "C-2",
      lastName: "FICTIF",
      firstNames: "Deux",
      cnpsNumber: "",
      baseSalary: "150000",
    }),
  );
  period = ok(await makeOpenPeriod(db)(ctx(U.owner), { year: 2026, month: 7 })).periodId;
  ok(await makeCalculatePeriod(db, { allowDraftRules: false })(ctx(U.owner), { periodId: period }));
});

afterAll(async () => {
  await db.$client.end();
});

describe("génération", () => {
  it("refuse un mois non validé", async () => {
    expect(await generate(ctx(U.owner), { periodId: period })).toEqual(
      rule("period_not_validated"),
    );
  });

  it("génère CNPS, DGI et DIPE avec montants dus et échéance au 15 du mois suivant", async () => {
    ok(
      await makeValidatePeriod(db, { verifyPassword: async () => true })(ctx(U.owner), {
        periodId: period,
        password: "x",
      }),
    );
    const res = ok(await generate(ctx(U.owner), { periodId: period }));
    expect(res.headcount).toBe(2);
    const rows = await declarationsOf();
    expect(rows.map((d) => [d.kind, d.status, d.dueDate])).toEqual([
      ["cnps", "generated", "2026-08-15"],
      ["dgi", "generated", "2026-08-15"],
      ["dipe", "generated", "2026-08-15"],
    ]);
    // 400 000 FCFA (cas de contrôle 1) + 150 000 FCFA
    expect(rows.find((d) => d.kind === "cnps")?.amountDue).toBe(res.cnps);
    expect(res.cnps).toBeGreaterThan(68_600);
    expect(rows.find((d) => d.kind === "dipe")?.amountDue).toBe(0);
  });

  it("les fichiers stockés se relisent ; l'état CNPS porte le n° CNPS en clair", async () => {
    const d = await byKind("cnps");
    const { token } = ok(
      await makeAuthorizeDownload(db, keyring)(ctx(U.accountant), {
        documentId: d?.documentId ?? "",
      }),
    );
    const file = await readSignedDownload(db, { keyring, storage }, token);
    const rows = await readSheet(file?.pdf ?? Buffer.alloc(0));
    expect(String(rows[0]?.[0])).toBe("État des cotisations CNPS");
    expect(rows.some((r) => r[2] === "987654321")).toBe(true);
    expect(rows.find((r) => r[0] === "TOTAL")?.[9]).toBe(d?.amountDue);
  });

  it("régénération possible tant que rien n'est déposé", async () => {
    const before = (await byKind("dgi"))?.documentId;
    ok(await generate(ctx(U.owner), { periodId: period }));
    expect((await byKind("dgi"))?.documentId).not.toBe(before);
  });
});

describe("dépôt, paiement, verrouillage", () => {
  it("le comptable consulte mais ne déclare pas", async () => {
    expect((await list(ctx(U.accountant), { periodId: period })).ok).toBe(true);
    expect(await generate(ctx(U.accountant), { periodId: period })).toEqual({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(
      await filed(ctx(U.accountant), {
        declarationId: (await byKind("cnps"))?.id,
        filedAt: "2026-08-10",
        reference: "X1",
      }),
    ).toEqual({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });

  it("dépôt : date future refusée, retard signalé, puis plus de régénération", async () => {
    const cnps = await byKind("cnps");
    expect(
      await filed(ctx(U.owner), {
        declarationId: cnps?.id,
        filedAt: "2099-01-01",
        reference: "CNPS-1",
      }),
    ).toEqual(rule("date_in_future"));
    expect(
      ok(
        await filed(ctx(U.owner), {
          declarationId: cnps?.id,
          filedAt: "2026-08-20",
          reference: "CNPS-1",
        }),
      ).late,
    ).toBe(true);
    expect(
      await filed(ctx(U.owner), {
        declarationId: cnps?.id,
        filedAt: "2026-08-20",
        reference: "CNPS-1",
      }),
    ).toEqual(rule("already_filed"));
    expect(await generate(ctx(U.owner), { periodId: period })).toEqual(rule("already_filed"));
  });

  it("paiement seulement après dépôt", async () => {
    expect(
      await paid(ctx(U.owner), { declarationId: (await byKind("dgi"))?.id, paidAt: "2026-08-12" }),
    ).toEqual(rule("not_filed"));
    ok(
      await paid(ctx(U.owner), {
        declarationId: (await byKind("cnps"))?.id,
        paidAt: "2026-08-21",
        reference: "VIR-55",
      }),
    );
    expect(
      await paid(ctx(U.owner), { declarationId: (await byKind("cnps"))?.id, paidAt: "2026-08-21" }),
    ).toEqual(rule("already_paid"));
  });

  it("verrouillage seulement quand les trois déclarations sont déposées", async () => {
    expect(await lock(ctx(U.owner), { periodId: period })).toEqual(rule("declarations_not_filed"));
    for (const kind of ["dgi", "dipe"]) {
      ok(
        await filed(ctx(U.owner), {
          declarationId: (await byKind(kind))?.id,
          filedAt: "2026-08-14",
          reference: `${kind}-ref`,
        }),
      );
    }
    ok(await lock(ctx(U.owner), { periodId: period }));
    expect((await declarationsOf())[0]?.periodStatus).toBe("locked");
    expect(await lock(ctx(U.owner), { periodId: period })).toEqual(rule("period_not_validated"));
  });

  it("le journal de paie s'exporte, même verrouillé, par le comptable", async () => {
    const res = ok(await makeExportJournal(db, keyring)(ctx(U.accountant), { periodId: period }));
    const rows = await readSheet(res.file);
    expect(String(rows[0]?.[0])).toBe("Journal de paie");
    expect(res.filename).toBe("journal-paie-2026-07.xlsx");
  });

  it("anti-IDOR : B ne voit ni ne modifie les déclarations de A", async () => {
    const cnps = await byKind("dgi");
    expect(ok(await list(ctx(U.ownerB, B), {}))).toEqual([]);
    expect(
      await filed(ctx(U.ownerB, B), {
        declarationId: cnps?.id,
        filedAt: "2026-08-10",
        reference: "PIRATE",
      }),
    ).toEqual(rule("not_found"));
    expect(await generate(ctx(U.ownerB, B), { periodId: period })).toEqual(rule("not_found"));
  });
});
