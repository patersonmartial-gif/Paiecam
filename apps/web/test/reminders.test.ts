import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
  makeGenerateDeclarations,
  makeListDeclarations,
  makeMarkFiled,
} from "@/server/features/declarations";
import { makeCreateEmployee } from "@/server/features/employees";
import { makeCalculatePeriod, makeOpenPeriod, makeValidatePeriod } from "@/server/features/payroll";
import { reminderStage, runDeadlineReminders, todayInDouala } from "@/server/features/reminders";
import type { Mail } from "@/server/mail";

describe("reminderStage", () => {
  it("fenêtres J-7, J-2, J0 et retard", () => {
    expect(reminderStage("2026-08-15", "2026-08-07")).toBeNull();
    expect(reminderStage("2026-08-15", "2026-08-08")).toBe("j-7");
    expect(reminderStage("2026-08-15", "2026-08-12")).toBe("j-7");
    expect(reminderStage("2026-08-15", "2026-08-13")).toBe("j-2");
    expect(reminderStage("2026-08-15", "2026-08-14")).toBe("j-2");
    expect(reminderStage("2026-08-15", "2026-08-15")).toBe("j0");
    expect(reminderStage("2026-08-15", "2026-09-01")).toBe("late");
  });
  it("la date du jour est celle de Douala (UTC+1)", () => {
    expect(todayInDouala(new Date("2026-08-14T23:30:00Z"))).toBe("2026-08-15");
    expect(todayInDouala(new Date("2026-08-14T22:30:00Z"))).toBe("2026-08-14");
  });
});

const db = createDb(testDatabaseUrl());
const keyring = parseKeyring(`v1:${Buffer.alloc(32, 1).toString("base64")}`);
const storage = createFsStorage(mkdtempSync(join(tmpdir(), "paiecam-rem-")), keyring);
const sent: Mail[] = [];
const mailer = { send: async (m: Mail) => void sent.push(m) };
const run = (today: string, m = mailer) =>
  runDeadlineReminders(db, { mailer: m, baseURL: "http://localhost", today });

const U = {
  owner: "rm-owner",
  manager: "rm-manager",
  accountant: "rm-accountant",
  ownerB: "rm-owner-b",
};
let A = "";
let periodA = "";
const ctx = (userId: string, tenantId: string): RequestContext => ({
  user: { id: userId, twoFactorEnabled: true },
  tenantId,
  ip: null,
  userAgent: null,
});
const ok = <T>(r: { ok: true; data: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.data;
};

async function validatedMonthWithDeclarations(tenantId: string, owner: string, matricule: string) {
  ok(
    await makeCreateEmployee(db, keyring)(ctx(owner, tenantId), {
      matricule,
      lastName: "FICTIF",
      firstNames: "R",
      birthDate: "1990-01-01",
      cnpsNumber: "",
      hireDate: "2024-01-01",
      contractType: "cdi",
      endDate: "",
      jobTitle: "Agent",
      category: "3",
      echelon: "A",
      baseSalary: "200000",
      maritalStatus: "single",
      childrenCount: "0",
      paymentMethod: "cash",
    }),
  );
  const periodId = ok(
    await makeOpenPeriod(db)(ctx(owner, tenantId), { year: 2026, month: 7 }),
  ).periodId;
  ok(await makeCalculatePeriod(db, { allowDraftRules: false })(ctx(owner, tenantId), { periodId }));
  ok(
    await makeValidatePeriod(db, { verifyPassword: async () => true })(ctx(owner, tenantId), {
      periodId,
      password: "x",
    }),
  );
  ok(await makeGenerateDeclarations(db, { keyring, storage })(ctx(owner, tenantId), { periodId }));
  return periodId;
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
  const tenant = (n: string): NewTenant => ({
    legalName: `Hôtel fictif ${n}`,
    niu: `H0000000000${n}`,
    cnpsEmployerNumber: `000-000000-${n}`,
    regime: "general",
    workAccidentRate: 175,
    commune: "Limbe",
  });
  A = await withUser(db, U.owner, (tx) => createTenantWithOwner(tx, U.owner, tenant("A")));
  const B = await withUser(db, U.ownerB, (tx) => createTenantWithOwner(tx, U.ownerB, tenant("B")));
  await withTenant(db, { tenantId: A, userId: U.owner }, (tx) =>
    tx.insert(schema.memberships).values([
      { tenantId: A, userId: U.manager, role: "payroll_manager" },
      { tenantId: A, userId: U.accountant, role: "accountant" },
    ]),
  );
  periodA = await validatedMonthWithDeclarations(A, U.owner, "R-1");
  await validatedMonthWithDeclarations(B, U.ownerB, "R-2");
});

afterAll(async () => {
  await db.$client.end();
});

describe("runDeadlineReminders", () => {
  it("rien avant J-7", async () => {
    expect(await run("2026-08-07")).toEqual({ sent: 0, recipients: 0 });
  });

  it("J-7 : un e-mail par déclaration au propriétaire et au gestionnaire paie, pas au comptable", async () => {
    sent.length = 0;
    // A : 3 déclarations × 2 destinataires ; B : 3 × 1
    expect(await run("2026-08-08")).toEqual({ sent: 6, recipients: 9 });
    const toA = sent.filter((m) => m.text.startsWith("Hôtel fictif A"));
    expect(new Set(toA.map((m) => m.to))).toEqual(
      new Set(["rm-owner@exemple.test", "rm-manager@exemple.test"]),
    );
    expect(sent.some((m) => m.to === "rm-accountant@exemple.test")).toBe(false);
    expect(
      sent
        .filter((m) => m.to === "rm-owner-b@exemple.test")
        .every((m) => m.text.startsWith("Hôtel fictif B")),
    ).toBe(true);
    expect(toA.find((m) => m.subject.includes("Cotisations CNPS"))?.subject).toBe(
      "[PaieCam] Cotisations CNPS de 07/2026 : échéance dans 7 jours ou moins (15/08/2026)",
    );
  });

  it("une étape ne part qu'une fois, même si la tâche tourne chaque jour", async () => {
    expect(await run("2026-08-08")).toEqual({ sent: 0, recipients: 0 });
    expect(await run("2026-08-11")).toEqual({ sent: 0, recipients: 0 });
  });

  it("une étape manquée est rattrapée ; un envoi échoué est retenté", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = { send: async () => Promise.reject(new Error("SMTP indisponible")) };
    expect(await run("2026-08-14", failing)).toEqual({ sent: 0, recipients: 0 });
    err.mockRestore();
    expect((await run("2026-08-14")).sent).toBe(6);
  });

  it("plus de rappel pour une déclaration déposée ; retard signalé pour les autres", async () => {
    const list = ok(await makeListDeclarations(db)(ctx(U.owner, A), { periodId: periodA }));
    const dgi = list.find((d) => d.kind === "dgi");
    ok(
      await makeMarkFiled(db)(ctx(U.owner, A), {
        declarationId: dgi?.id,
        filedAt: "2026-08-14",
        reference: "DGI-1",
      }),
    );
    sent.length = 0;
    await run("2026-08-16");
    const subjectsA = sent.filter((m) => m.text.startsWith("Hôtel fictif A")).map((m) => m.subject);
    expect(subjectsA.some((s) => s.includes("DGI"))).toBe(false);
    expect(subjectsA.filter((s) => s.includes("EN RETARD")).length).toBe(4);
  });
});
