/**
 * Test de restauration de bout en bout : sauvegarde chiffrée de la base de test avec le rôle
 * paiecam_backup, restauration dans une base vide, puis contrôle des données, du RLS et des
 * déclencheurs. Une sauvegarde qui n'a jamais été restaurée n'est pas une sauvegarde.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { createDb, createTenantWithOwner, withTenant, withUser, type NewTenant } from "../src";
import { auditLog, users } from "../src/schema";
import {
  loadTestRules,
  recreateRestoreTestDatabase,
  testBackupDatabaseUrl,
  testDatabaseUrl,
  testRestoreAdminDatabaseUrl,
  validateAllTestRules,
} from "../src/testing";
import { db } from "./db";

const SCRIPTS = new URL("../../../scripts/backup/", import.meta.url).pathname;
const work = mkdtempSync(join(tmpdir(), "paiecam-backup-"));
const key = join(work, "key.txt");
const recipients = join(work, "recipients.txt");

/** Même serveur, autre base : remplace le nom de la base dans une URL de connexion. */
const onDb = (url: string, name: string) => {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
};
const adminUrl = testRestoreAdminDatabaseUrl();
const restoredDbName = new URL(adminUrl).pathname.slice(1);

function run(script: string, args: string[], env: Record<string, string>) {
  const r = spawnSync("bash", [join(SCRIPTS, script), ...args], {
    env: { PATH: process.env.PATH ?? "", ...env },
    encoding: "utf8",
  });
  return { code: r.status, out: r.stdout.trim(), err: r.stderr };
}

const restore = (dir: string, identity = key) =>
  run("restore.sh", [dir], { RESTORE_ADMIN_DATABASE_URL: adminUrl, AGE_IDENTITY: identity });

const fakeTenant = (n: string): NewTenant => ({
  legalName: `Entreprise fictive ${n}`,
  niu: `M0000000000${n}`,
  cnpsEmployerNumber: `000-000000-${n}`,
  regime: "general",
  workAccidentRate: 175,
  commune: "Douala 1er",
});

let tenantA: string;
let backupDir: string;

beforeAll(async () => {
  for (const [file, cmd] of [
    [key, ["age-keygen", "-o", key]],
    [recipients, ["age-keygen", "-y", key]],
  ] as const) {
    const r = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`${cmd[0]} : ${r.stderr}`);
    if (file === recipients) writeFileSync(recipients, r.stdout);
  }
  await db
    .insert(users)
    .values(["bk-a", "bk-b"].map((id) => ({ id, name: id, email: `${id}@exemple.test` })));
  tenantA = await withUser(db, "bk-a", (tx) => createTenantWithOwner(tx, "bk-a", fakeTenant("A")));
  const tenantB = await withUser(db, "bk-b", (tx) =>
    createTenantWithOwner(tx, "bk-b", fakeTenant("B")),
  );
  await withTenant(db, { tenantId: tenantA, userId: "bk-a" }, (tx) =>
    tx.insert(auditLog).values({ tenantId: tenantA, actorUserId: "bk-a", action: "test.a" }),
  );
  await withTenant(db, { tenantId: tenantB, userId: "bk-b" }, (tx) =>
    tx.insert(auditLog).values({ tenantId: tenantB, actorUserId: "bk-b", action: "test.b" }),
  );
  await loadTestRules([
    { code: "cac", validFrom: "2026-01-01", validTo: null, value: { rateOfIrpp: 1000 } },
  ]);
  await validateAllTestRules();

  const r = run("backup.sh", [], {
    BACKUP_DATABASE_URL: testBackupDatabaseUrl(),
    BACKUP_AGE_RECIPIENTS: recipients,
    BACKUP_DIR: join(work, "out"),
  });
  expect(r.err).toBe("");
  expect(r.code).toBe(0);
  backupDir = r.out;
  await recreateRestoreTestDatabase();
}, 60_000);

afterAll(async () => {
  await db.$client.end();
});

/** Nombre de lignes de chaque table du schéma public, vu sans RLS. */
async function counts(url: string): Promise<Record<string, number>> {
  const c = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const tables = await c<{ t: string }[]>`
      select tablename as t from pg_tables where schemaname = 'public' order by 1`;
    const out: Record<string, number> = {};
    for (const { t } of tables) {
      const [row] = await c<{ n: string }[]>`select count(*)::text as n from ${c(t)}`;
      out[t] = Number(row?.n);
    }
    return out;
  } finally {
    await c.end();
  }
}

/** Politiques RLS et tables à RLS forcé : leur description doit être identique après restauration. */
async function securityShape(url: string) {
  const c = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const policies = await c`
      select tablename, policyname, roles::text, cmd, qual, with_check from pg_policies order by 1, 2`;
    const forced = await c`
      select relname from pg_class where relforcerowsecurity and relrowsecurity order by 1`;
    const triggers = await c`
      select tgrelid::regclass::text as t, tgname from pg_trigger where not tgisinternal order by 1, 2`;
    return { policies: [...policies], forced: [...forced], triggers: [...triggers] };
  } finally {
    await c.end();
  }
}

describe("sauvegarde", () => {
  it("est chiffrée avec age et accompagnée de ses empreintes", () => {
    expect(readFileSync(join(backupDir, "db.dump.age")).subarray(0, 21).toString()).toBe(
      "age-encryption.org/v1",
    );
    expect(readFileSync(join(backupDir, "SHA256SUMS"), "utf8")).toMatch(
      /^[0-9a-f]{64} {2}db\.dump\.age\n$/,
    );
  });

  it("le rôle de sauvegarde lit tout mais ne peut rien écrire", async () => {
    const c = postgres(testBackupDatabaseUrl(), { max: 1, onnotice: () => {} });
    try {
      const [row] = await c`select count(*)::int as n from audit_log where action like 'test.%'`;
      expect(row?.n).toBe(2);
      await expect(c`delete from audit_log`).rejects.toThrow(/permission denied/);
    } finally {
      await c.end();
    }
  });
});

describe("restauration", () => {
  it("refuse une sauvegarde altérée sans toucher à la base", async () => {
    const tampered = join(work, "altérée");
    cpSync(backupDir, tampered, { recursive: true });
    const f = join(tampered, "db.dump.age");
    const bytes = readFileSync(f);
    bytes[bytes.length - 10] = (bytes[bytes.length - 10] ?? 0) ^ 0xff;
    writeFileSync(f, bytes);
    const r = restore(tampered);
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/altérée/);
  });

  it("échoue avec une autre clé privée et n'écrit rien (transaction unique)", async () => {
    const other = join(work, "autre-cle.txt");
    spawnSync("age-keygen", ["-o", other]);
    expect(restore(backupDir, other).code).not.toBe(0);
    expect(await counts(adminUrl)).toEqual({});
  });

  it("restaure les données, les politiques RLS et les déclencheurs à l'identique", async () => {
    const r = restore(backupDir);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(await counts(adminUrl)).toEqual(await counts(testBackupDatabaseUrl()));
    expect(await securityShape(adminUrl)).toEqual(await securityShape(testBackupDatabaseUrl()));
  });

  it("le rôle applicatif reste cloisonné par entreprise dans la base restaurée", async () => {
    const restored = createDb(onDb(testDatabaseUrl(), restoredDbName));
    try {
      const seen = await withTenant(restored, { tenantId: tenantA, userId: "bk-a" }, (tx) =>
        tx
          .select({ action: auditLog.action })
          .from(auditLog)
          .where(sql`action like 'test.%'`),
      );
      expect(seen).toEqual([{ action: "test.a" }]);
      const none = await restored.select({ action: auditLog.action }).from(auditLog);
      expect(none).toEqual([]);
    } finally {
      await restored.$client.end();
    }
  });

  it("les règles de paie validées restent figées", async () => {
    const c = postgres(adminUrl, { max: 1, onnotice: () => {} });
    try {
      await expect(c`update pay_rules set value = '{}'::jsonb where code = 'cac'`).rejects.toThrow(
        /seule la date de fin/,
      );
    } finally {
      await c.end();
    }
  });

  it("refuse de restaurer dans une base non vide", () => {
    const r = restore(backupDir);
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/pas vide/);
  });
});
