import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Encrypter } from "age-encryption";
import { strToU8, zipSync } from "fflate";
import {
  recreateRestoreTestDatabase,
  testBackupDatabaseUrl,
  testDatabaseUrl,
  testRestoreAdminDatabaseUrl,
} from "@paiecam/db/testing";
import { createBackup, generateRecoveryKey, listBackups, openBackup, restoreBackup } from "../src";

const work = mkdtempSync(join(tmpdir(), "paiecam-local-"));
const documentsDir = join(work, "documents");
const backupDir = join(work, "sauvegardes");
const secrets = { FIELD_ENCRYPTION_KEYS: "v1:fictif", BETTER_AUTH_SECRET: "secret-fictif" };
let key: { identity: string; recipient: string };
let backupFile = "";

const config = (over: Partial<Parameters<typeof createBackup>[0]> = {}) => ({
  databaseUrl: testBackupDatabaseUrl(),
  documentsDir,
  backupDir,
  recipient: key.recipient,
  secrets,
  appVersion: "0.0.0-test",
  ...over,
});

/** Nombre de lignes par table du schéma public (rôle de sauvegarde : sans RLS). */
async function counts(url: string) {
  const c = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const out: Record<string, number> = {};
    for (const { t } of await c<{ t: string }[]>`
      select tablename as t from pg_tables where schemaname = 'public' order by 1`) {
      const [r] = await c<{ n: number }[]>`select count(*)::int as n from ${c(t)}`;
      out[t] = r?.n ?? -1;
    }
    return out;
  } finally {
    await c.end();
  }
}

beforeAll(async () => {
  key = await generateRecoveryKey();
  await mkdir(join(documentsDir, "tenant-a", "2026-05"), { recursive: true });
  await writeFile(join(documentsDir, "tenant-a", "2026-05", "doc.pdf"), "%PDF-chiffre-fictif");
  // Des données dans la base de test, pour que la comparaison ait du sens.
  const app = postgres(testDatabaseUrl(), { max: 1, onnotice: () => {} });
  try {
    await app`insert into users (id, name, email, email_verified, created_at, updated_at)
              values ('local-bk', 'local-bk', 'local-bk@exemple.test', false, now(), now())
              on conflict do nothing`;
  } finally {
    await app.end();
  }
  await recreateRestoreTestDatabase();
}, 60_000);

afterAll(async () => {
  await recreateRestoreTestDatabase();
});

describe("sauvegarde locale", () => {
  it("un seul fichier chiffré avec age, au nom horodaté", async () => {
    const b = await createBackup(config({ now: new Date(2026, 9, 24, 12, 30, 5) }));
    backupFile = b.path;
    expect(b.name).toBe("paiecam-2026-10-24-123005.sauvegarde");
    expect(readFileSync(b.path).subarray(0, 21).toString()).toBe("age-encryption.org/v1");
    // Ni les secrets ni les documents ne sont lisibles dans le fichier.
    const raw = readFileSync(b.path).toString("latin1");
    expect(raw).not.toContain("secret-fictif");
    expect(raw).not.toContain("%PDF-chiffre-fictif");
    expect(readdirSync(backupDir)).toEqual([b.name]);
  });

  it("se relit avec la clé du kit : base, documents et secrets", async () => {
    const b = await openBackup(backupFile, key.identity);
    expect(b.manifest).toMatchObject({ format: 1, appVersion: "0.0.0-test", documents: 1 });
    expect(b.secrets).toEqual(secrets);
    expect(Buffer.from(b.documents.get("tenant-a/2026-05/doc.pdf") ?? []).toString()).toBe(
      "%PDF-chiffre-fictif",
    );
    expect(Buffer.from(b.dump.subarray(0, 5)).toString()).toBe("PGDMP");
  });

  it("refuse une autre clé ou un fichier altéré", async () => {
    const other = await generateRecoveryKey();
    await expect(openBackup(backupFile, other.identity)).rejects.toThrow(/illisible/);
    const tampered = join(work, "altere.sauvegarde");
    const bytes = readFileSync(backupFile);
    bytes[bytes.length - 20] = (bytes[bytes.length - 20] ?? 0) ^ 0xff;
    writeFileSync(tampered, bytes);
    await expect(openBackup(tampered, key.identity)).rejects.toThrow(/illisible/);
  });

  it("refuse une archive piégée (chemin qui sort du dossier des documents)", async () => {
    const zip = zipSync({
      "manifest.json": strToU8(JSON.stringify({ format: 1, documents: 1 })),
      "secrets.json": strToU8("{}"),
      "db.dump": strToU8("PGDMP"),
      "documents/../../evil.txt": strToU8("x"),
    });
    const enc = new Encrypter();
    enc.addRecipient(key.recipient);
    const file = join(work, "piege.sauvegarde");
    writeFileSync(file, await enc.encrypt(zip));
    await expect(openBackup(file, key.identity)).rejects.toThrow(/chemin de document invalide/);
  });

  it("ne garde que les N dernières sauvegardes", async () => {
    const dir = join(work, "rotation");
    for (const day of [1, 2, 3]) {
      await createBackup(config({ backupDir: dir, keep: 2, now: new Date(2026, 9, day, 12) }));
    }
    expect((await listBackups(dir)).map((b) => b.name)).toEqual([
      "paiecam-2026-10-03-120000.sauvegarde",
      "paiecam-2026-10-02-120000.sauvegarde",
    ]);
    expect(await listBackups(join(work, "absent"))).toEqual([]);
  });
});

describe("restauration locale", () => {
  it("dans une base et un dossier vides : données identiques, secrets rendus", async () => {
    const target = join(work, "documents-restaures");
    const restored = await restoreBackup({
      file: backupFile,
      identity: key.identity,
      adminDatabaseUrl: testRestoreAdminDatabaseUrl(),
      documentsDir: target,
    });
    expect(restored).toEqual(secrets);
    expect(readFileSync(join(target, "tenant-a", "2026-05", "doc.pdf"), "utf8")).toBe(
      "%PDF-chiffre-fictif",
    );
    expect(await counts(testRestoreAdminDatabaseUrl())).toEqual(
      await counts(testBackupDatabaseUrl()),
    );
  });

  it("refuse d'écraser une base ou un dossier non vides", async () => {
    await expect(
      restoreBackup({
        file: backupFile,
        identity: key.identity,
        adminDatabaseUrl: testRestoreAdminDatabaseUrl(),
        documentsDir: join(work, "vide"),
      }),
    ).rejects.toThrow(/base cible n'est pas vide/);
    await recreateRestoreTestDatabase();
    await expect(
      restoreBackup({
        file: backupFile,
        identity: key.identity,
        adminDatabaseUrl: testRestoreAdminDatabaseUrl(),
        documentsDir,
      }),
    ).rejects.toThrow(/dossier des documents n'est pas vide/);
  });
});
