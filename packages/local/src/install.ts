/**
 * Les trois opérations de l'installation locale, appelées par l'outil d'administration :
 * installer, mettre à jour (sauvegarde d'abord), restaurer une sauvegarde.
 */
import { access, mkdir, readdir, rename, writeFile } from "node:fs/promises";
import { loadPayRules, runMigrations, type RuleToLoad } from "@paiecam/db/maintenance";
import { createBackup, restoreBackup } from "./backup";
import { runPg } from "./pg";
import {
  adminEnvFile,
  appEnvFile,
  createRolesAndDatabase,
  dbUrl,
  generateSecrets,
  initCluster,
  layout,
  readEnvFile,
  recoveryKit,
  startCluster,
  stopCluster,
  updateEnvFile,
  type ClusterOptions,
} from "./setup";

const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false,
  );

export interface InstallOptions {
  root: string;
  pgBinDir?: string | undefined;
  port?: number;
  appPort?: number;
  rules: readonly RuleToLoad[];
  migrationsFolder?: string;
  runAs?: ClusterOptions["runAs"];
  /** Laisser la base démarrée (tests) ; sinon arrêtée, le service Windows prend le relais. */
  keepRunning?: boolean;
  now?: Date;
}

export async function installLocal(o: InstallOptions) {
  const l = layout(o.root);
  if (await exists(l.configFile)) throw new Error("PaieCam est déjà installé dans ce dossier");
  const port = o.port ?? 5433;
  const appPort = o.appPort ?? 3000;
  const secrets = await generateSecrets();
  const cluster: ClusterOptions = {
    pgBinDir: o.pgBinDir,
    dataDir: l.dataDir,
    port,
    runAs: o.runAs,
  };
  for (const d of [l.documentsDir, l.backupDir, `${o.root}/config`]) {
    await mkdir(d, { recursive: true });
  }
  await initCluster({ ...cluster, superuserPassword: secrets.superuserPassword });
  await startCluster(cluster);
  try {
    await createRolesAndDatabase(cluster, secrets);
    const owner = dbUrl("paiecam_owner", secrets.passwords.owner, port);
    await runMigrations(owner, o.migrationsFolder);
    await loadPayRules(owner, o.rules);
  } finally {
    if (!o.keepRunning) await stopCluster(cluster);
  }
  // Fichiers lisibles par le seul compte d'installation (Windows : droits posés par l'installateur).
  await writeFile(l.configFile, appEnvFile(l, secrets, { port, appPort, pgBinDir: o.pgBinDir }), {
    mode: 0o600,
  });
  await writeFile(l.adminConfigFile, adminEnvFile(secrets, { port }), { mode: 0o600 });
  await writeFile(l.recoveryKitFile, recoveryKit(secrets, o.now ?? new Date()), { mode: 0o600 });
  return { layout: l, recoveryIdentity: secrets.recovery.identity, cluster };
}

/** Mise à jour : sauvegarde complète, puis migrations et référentiel livrés avec la version. */
export async function updateLocal(o: {
  root: string;
  rules: readonly RuleToLoad[];
  migrationsFolder?: string;
  appVersion: string;
}) {
  const l = layout(o.root);
  const app = await readEnvFile(l.configFile);
  const admin = await readEnvFile(l.adminConfigFile);
  const backup = await createBackup({
    pgBinDir: app.PG_BIN_DIR,
    databaseUrl: app.BACKUP_DATABASE_URL ?? "",
    documentsDir: app.DOCUMENTS_DIR ?? l.documentsDir,
    backupDir: app.BACKUP_DIR ?? l.backupDir,
    recipient: app.BACKUP_RECIPIENT ?? "",
    secrets: {
      FIELD_ENCRYPTION_KEYS: app.FIELD_ENCRYPTION_KEYS ?? "",
      BETTER_AUTH_SECRET: app.BETTER_AUTH_SECRET ?? "",
    },
    appVersion: o.appVersion,
  });
  await runMigrations(admin.MIGRATION_DATABASE_URL ?? "", o.migrationsFolder);
  const rules = await loadPayRules(admin.MIGRATION_DATABASE_URL ?? "", o.rules);
  return { backup, rules };
}

/** Seuls ces secrets peuvent venir d'une sauvegarde : elle ne réécrit jamais le reste. */
const RESTORABLE_SECRETS = ["FIELD_ENCRYPTION_KEYS", "BETTER_AUTH_SECRET"] as const;

/**
 * Restauration sur cette installation (services de l'application arrêtés) : la base est
 * recréée vide puis restaurée ; les documents actuels sont mis de côté, jamais effacés.
 */
export async function restoreLocal(o: { root: string; file: string; identity: string }) {
  const l = layout(o.root);
  const app = await readEnvFile(l.configFile);
  const admin = await readEnvFile(l.adminConfigFile);
  const superuser = admin.PG_SUPERUSER_URL ?? "";
  for (const sql of [
    "drop database if exists paiecam with (force)",
    "create database paiecam owner paiecam_owner",
  ]) {
    await runPg("psql", app.PG_BIN_DIR, superuser, ["-v", "ON_ERROR_STOP=1", "-qc", sql]);
  }
  const documentsDir = app.DOCUMENTS_DIR ?? l.documentsDir;
  if ((await exists(documentsDir)) && (await readdir(documentsDir)).length > 0) {
    await rename(documentsDir, `${documentsDir}-avant-restauration-${Date.now()}`);
  }
  const target = new URL(superuser);
  target.pathname = "/paiecam";
  const secrets = await restoreBackup({
    file: o.file,
    identity: o.identity,
    adminDatabaseUrl: target.toString(),
    documentsDir,
    pgBinDir: app.PG_BIN_DIR,
  });
  const values: Record<string, string> = {};
  for (const k of RESTORABLE_SECRETS) {
    const v = secrets[k];
    if (!v) throw new Error(`sauvegarde sans ${k}`);
    values[k] = v;
  }
  await updateEnvFile(l.configFile, values);
}
