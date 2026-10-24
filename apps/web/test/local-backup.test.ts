import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, createTenantWithOwner, schema, withTenant, withUser } from "@paiecam/db";
import { testDatabaseUrl } from "@paiecam/db/testing";
import type { Env } from "@/env-schema";
import type { RequestContext } from "@/server/authz/action";
import { makeRequestBackup } from "@/server/features/backups";
import { backupIsDue, lastBackupAge, localBackupConfigured } from "@/server/jobs/local-backup";
import { APP_VERSION } from "@/version";

const db = createDb(testDatabaseUrl());
const U = { owner: "bk-owner", accountant: "bk-accountant" };
let A = "";
const ctx = (userId: string): RequestContext => ({
  user: { id: userId, twoFactorEnabled: true },
  tenantId: A,
  ip: "203.0.113.90",
  userAgent: "vitest",
});

beforeAll(async () => {
  await db
    .insert(schema.users)
    .values(Object.values(U).map((id) => ({ id, name: id, email: `${id}@exemple.test` })));
  A = await withUser(db, U.owner, (tx) =>
    createTenantWithOwner(tx, U.owner, {
      legalName: "Atelier fictif sauvegarde",
      niu: "S000000000001K",
      cnpsEmployerNumber: "000-000000-S",
      regime: "general",
      workAccidentRate: 175,
      commune: "Buea",
    }),
  );
  await withTenant(db, { tenantId: A, userId: U.owner }, (tx) =>
    tx.insert(schema.memberships).values({ tenantId: A, userId: U.accountant, role: "accountant" }),
  );
});

afterAll(async () => {
  await db.$client.end();
});

describe("installation locale : sauvegardes", () => {
  it("la version inscrite dans les sauvegardes est celle du paquet", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(APP_VERSION).toBe(pkg.version);
  });

  it("seul le propriétaire demande une sauvegarde immédiate, et c'est tracé", async () => {
    let calls = 0;
    const request = makeRequestBackup(db, { enqueue: async () => void calls++ });
    expect(await request(ctx(U.accountant), {})).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(await request(ctx(U.owner), {})).toEqual({ ok: true, data: { requested: true } });
    expect(calls).toBe(1);
    const audit = await withTenant(db, { tenantId: A, userId: U.owner }, (tx) =>
      tx.select({ action: schema.auditLog.action }).from(schema.auditLog),
    );
    expect(audit.map((a) => a.action)).toContain("backups.request");
  });

  it("échéance : due sans sauvegarde ou au-delà de 20 h, pas avant", async () => {
    const dir = mkdtempSync(join(tmpdir(), "paiecam-due-"));
    const env = {
      BACKUP_DIR: dir,
      BACKUP_RECIPIENT: `age1${"q".repeat(58)}`,
      BACKUP_DATABASE_URL: "postgres://x@localhost/x",
    } as Env;
    expect(localBackupConfigured(env)).toBe(true);
    expect(localBackupConfigured({ ...env, BACKUP_DIR: undefined } as Env)).toBe(false);
    expect(await lastBackupAge(env)).toBeNull();
    expect(await backupIsDue(env)).toBe(true);
    writeFileSync(join(dir, "paiecam-2026-10-24-123000.sauvegarde"), "x");
    const at = (h: number) => new Date(2026, 9, 24, 12 + h, 30).getTime();
    expect(await backupIsDue(env, at(19))).toBe(false);
    expect(await backupIsDue(env, at(21))).toBe(true);
  });
});
