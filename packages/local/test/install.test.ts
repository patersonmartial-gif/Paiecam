/**
 * Installation locale de bout en bout sur une vraie instance PostgreSQL dédiée (port 5544) :
 * installation, sauvegarde par la mise à jour, restauration, refus d'une seconde installation.
 * Sous Linux, initdb refuse root : le cluster tourne sous le compte système « postgres ».
 */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { loadRuleFile } from "@paiecam/paie-engine/rules";
import {
  createBackup,
  installLocal,
  layout,
  readEnvFile,
  restoreLocal,
  stopCluster,
  updateLocal,
  type ClusterOptions,
} from "../src";

// Binaires du serveur PostgreSQL (initdb, pg_ctl) : PG_BIN en CI, sinon pg_config.
const PG_BIN = process.env.PG_BIN ?? execFileSync("pg_config", ["--bindir"]).toString().trim();
const runAs =
  process.getuid?.() === 0
    ? {
        uid: Number(execFileSync("id", ["-u", "postgres"]).toString()),
        gid: Number(execFileSync("id", ["-g", "postgres"]).toString()),
      }
    : undefined;
const root = mkdtempSync(join(tmpdir(), "paiecam-install-"));
chmodSync(root, 0o755);
const rules = loadRuleFile(
  new URL("../../paie-engine/rules/cm-2026.draft.json", import.meta.url).pathname,
);
let identity = "";
let cluster: ClusterOptions;

async function query<T>(url: string, fn: (c: postgres.Sql) => Promise<unknown>): Promise<T[]> {
  const c = postgres(url, { max: 1, onnotice: () => {} });
  try {
    return (await fn(c)) as T[];
  } finally {
    await c.end();
  }
}

beforeAll(async () => {
  const res = await installLocal({
    root,
    pgBinDir: PG_BIN,
    port: 5544,
    appPort: 3999,
    rules,
    runAs,
    keepRunning: true,
    now: new Date(2026, 9, 24),
  });
  identity = res.recoveryIdentity;
  cluster = res.cluster;
}, 120_000);

afterAll(async () => {
  if (cluster) await stopCluster(cluster);
}, 60_000);

describe("installation locale", () => {
  it("configuration complète, secrets propres à l'installation, fichiers privés", async () => {
    const l = layout(root);
    const env = await readEnvFile(l.configFile);
    expect(env).toMatchObject({
      NODE_ENV: "production",
      DEPLOYMENT: "local",
      APP_URL: "http://localhost:3999",
      HOSTNAME: "127.0.0.1",
      STORAGE_DRIVER: "fs",
      DOCUMENTS_DIR: l.documentsDir,
      BACKUP_DIR: l.backupDir,
    });
    expect(env.BACKUP_RECIPIENT).toMatch(/^age1[0-9a-z]{58}$/);
    expect(env.FIELD_ENCRYPTION_KEYS).toMatch(/^v1:[A-Za-z0-9+/]{43}=$/);
    // L'application n'a pas les accès d'administration ; la clé secrète n'est que dans le kit.
    expect(env.PG_SUPERUSER_URL).toBeUndefined();
    expect(readFileSync(l.configFile, "utf8")).not.toContain(identity);
    expect(readFileSync(l.recoveryKitFile, "utf8")).toContain(identity);
    for (const f of [l.configFile, l.adminConfigFile, l.recoveryKitFile, l.backupDir]) {
      expect(statSync(f).mode & 0o077).toBe(0);
    }
  });

  it("base : écoute locale seulement, rôle applicatif soumis au RLS, référentiel chargé", async () => {
    const env = await readEnvFile(layout(root).configFile);
    const app = env.DATABASE_URL ?? "";
    expect(app).toMatch(/^postgres:\/\/paiecam_app:[0-9a-f]{48}@127\.0\.0\.1:5544\/paiecam$/);
    const [listen] = await query<{ listen_addresses: string }>(
      app,
      (c) => c`show listen_addresses`,
    );
    expect(listen?.listen_addresses).toBe("127.0.0.1");
    const [role] = await query<{ rolbypassrls: boolean; rolsuper: boolean }>(
      app,
      (c) => c`select rolbypassrls, rolsuper from pg_roles where rolname = current_user`,
    );
    expect(role).toEqual({ rolbypassrls: false, rolsuper: false });
    const [n] = await query<{ n: number }>(app, (c) => c`select count(*)::int as n from pay_rules`);
    expect(n?.n).toBe(rules.length);
  });

  it("refuse une seconde installation dans le même dossier", async () => {
    await expect(installLocal({ root, pgBinDir: PG_BIN, rules, runAs })).rejects.toThrow(
      /déjà installé/,
    );
  });

  it("mise à jour : sauvegarde d'abord ; restauration : retour exact à cette sauvegarde", async () => {
    const l = layout(root);
    const env = await readEnvFile(l.configFile);
    const app = env.DATABASE_URL ?? "";
    await query(
      app,
      (c) =>
        c`insert into users (id, name, email, email_verified, created_at, updated_at)
          values (${"avant"}, ${"avant"}, ${"avant@exemple.test"}, false, now(), now())`,
    );
    const { backup } = await updateLocal({ root, rules, appVersion: "0.1.0" });
    expect(existsSync(backup.path)).toBe(true);
    await query(
      app,
      (c) =>
        c`insert into users (id, name, email, email_verified, created_at, updated_at)
          values (${"apres"}, ${"apres"}, ${"apres@exemple.test"}, false, now(), now())`,
    );

    await restoreLocal({ root, file: backup.path, identity });
    const ids = await query<{ id: string }>(app, (c) => c`select id from users order by id`);
    expect(ids.map((r) => r.id)).toEqual(["avant"]);
    const [n] = await query<{ n: number }>(app, (c) => c`select count(*)::int as n from pay_rules`);
    expect(n?.n).toBe(rules.length);
    expect((await readEnvFile(l.configFile)).FIELD_ENCRYPTION_KEYS).toBe(env.FIELD_ENCRYPTION_KEYS);
  });

  it("une sauvegarde ne peut réécrire que les deux secrets prévus de la configuration", async () => {
    const l = layout(root);
    const env = await readEnvFile(l.configFile);
    const piege = await createBackup({
      pgBinDir: PG_BIN,
      databaseUrl: env.BACKUP_DATABASE_URL ?? "",
      documentsDir: l.documentsDir,
      backupDir: join(root, "pieges"),
      recipient: env.BACKUP_RECIPIENT ?? "",
      secrets: {
        FIELD_ENCRYPTION_KEYS: env.FIELD_ENCRYPTION_KEYS ?? "",
        BETTER_AUTH_SECRET: "secret-de-la-sauvegarde",
        DATABASE_URL: "postgres://pirate@exemple.test/x",
        PWNED_PASSWORDS_CHECK: "off",
      },
      appVersion: "0.1.0",
    });
    await restoreLocal({ root, file: piege.path, identity });
    const after = await readEnvFile(l.configFile);
    expect(after.BETTER_AUTH_SECRET).toBe("secret-de-la-sauvegarde");
    expect(after.DATABASE_URL).toBe(env.DATABASE_URL);
    expect(after.PWNED_PASSWORDS_CHECK).toBe("on");
  });
});

describe("configuration sous Windows", () => {
  it("chemins écrits avec « / » : aucune barre oblique inverse lue comme un échappement", async () => {
    const { appEnvFile, generateSecrets } = await import("../src");
    const l = layout("C:\\ProgramData\\PaieCam");
    const text = appEnvFile(l, await generateSecrets(), {
      port: 5433,
      appPort: 3000,
      pgBinDir: "C:\\Program Files\\PaieCam\\pgsql\\bin",
    });
    const { parseEnv } = await import("node:util");
    const env = parseEnv(text) as Record<string, string>;
    expect(env.DOCUMENTS_DIR).toBe("C:/ProgramData/PaieCam/donnees/documents");
    expect(env.BACKUP_DIR).toBe("C:/ProgramData/PaieCam/sauvegardes");
    expect(env.PG_BIN_DIR).toBe("C:/Program Files/PaieCam/pgsql/bin");
  });
});
