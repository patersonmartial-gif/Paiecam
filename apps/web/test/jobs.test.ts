import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createDb, createTenantWithOwner, schema, withTenant, withUser } from "@paiecam/db";
import { loadTestRules, testDatabaseUrl, validateAllTestRules } from "@paiecam/db/testing";
import { createFsStorage } from "@paiecam/documents";
import { loadRuleFile } from "@paiecam/paie-engine/rules";
import { parseKeyring } from "@paiecam/security";
import type { RequestContext } from "@/server/authz/action";
import { generatePeriodDocuments } from "@/server/features/documents";
import { makeCreateEmployee } from "@/server/features/employees";
import { makeCalculatePeriod, makeOpenPeriod, makeValidatePeriod } from "@/server/features/payroll";
import { PDF_QUEUE, startBoss, type PdfJob } from "@/server/jobs/boss";

const db = createDb(testDatabaseUrl());
const keyring = parseKeyring(`v1:${Buffer.alloc(32, 8).toString("base64")}`);
const storage = createFsStorage(mkdtempSync(join(tmpdir(), "paiecam-jobs-")), keyring);

afterAll(async () => {
  await db.$client.end();
});

describe("file pg-boss avec le rôle applicatif", () => {
  it("une validation mise en file produit le PDF archivé", async () => {
    await loadTestRules(
      loadRuleFile(
        new URL("../../../packages/paie-engine/rules/cm-2026.draft.json", import.meta.url).pathname,
      ),
    );
    await validateAllTestRules();
    await db
      .insert(schema.users)
      .values({ id: "job-owner", name: "o", email: "job-owner@exemple.test" });
    const tenantId = await withUser(db, "job-owner", (tx) =>
      createTenantWithOwner(tx, "job-owner", {
        legalName: "Garage fictif J",
        niu: "J00000000001",
        cnpsEmployerNumber: "000-000000-J",
        regime: "general",
        workAccidentRate: 175,
        commune: "Kumba",
      }),
    );
    const ctx: RequestContext = {
      user: { id: "job-owner", twoFactorEnabled: true },
      tenantId,
      ip: null,
      userAgent: null,
    };
    await makeCreateEmployee(db, keyring)(ctx, {
      matricule: "J-1",
      lastName: "FICTIF",
      firstNames: "Job",
      birthDate: "1990-01-01",
      cnpsNumber: "",
      hireDate: "2024-01-01",
      contractType: "cdi",
      endDate: "",
      jobTitle: "Mécanicien",
      category: "4",
      echelon: "A",
      baseSalary: "250000",
      maritalStatus: "single",
      childrenCount: "0",
      paymentMethod: "cash",
    });
    const open = await makeOpenPeriod(db)(ctx, { year: 2026, month: 6 });
    const periodId = open.ok ? open.data.periodId : "";
    await makeCalculatePeriod(db, { allowDraftRules: false })(ctx, { periodId });
    expect(
      (
        await makeValidatePeriod(db, { verifyPassword: async () => true })(ctx, {
          periodId,
          password: "x",
        })
      ).ok,
    ).toBe(true);

    const boss = await startBoss(testDatabaseUrl());
    try {
      const done = new Promise<{ generated: number }>((resolve, reject) => {
        void boss.work<PdfJob>(PDF_QUEUE, { pollingIntervalSeconds: 0.5 }, async ([job]) => {
          if (!job) return;
          try {
            resolve(
              await generatePeriodDocuments(
                db,
                { keyring, storage, baseURL: "http://localhost" },
                job.data,
              ),
            );
          } catch (e) {
            reject(e as Error);
          }
        });
      });
      expect(
        await boss.send(PDF_QUEUE, { tenantId, periodId } satisfies PdfJob, {
          singletonKey: periodId,
        }),
      ).toBeTruthy();
      expect(await done).toEqual({ generated: 1, skipped: 0 });
      const docs = await withTenant(db, { tenantId, userId: "job-owner" }, (tx) =>
        tx.select().from(schema.documents),
      );
      expect(docs).toHaveLength(1);
    } finally {
      await boss.stop({ graceful: false });
    }
  }, 30_000);
});
