/**
 * Installation locale : base PostgreSQL dédiée (écoute sur 127.0.0.1 uniquement), rôles aux
 * mots de passe aléatoires, configuration et kit de récupération. Aucun secret n'est fixe ni
 * réutilisé d'une installation à l'autre.
 */
import { randomBytes } from "node:crypto";
import { appendFile, chown, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generateRecoveryKey } from "./keys";
import { pgTool, run, runPg } from "./pg";

export const ROLES = ["owner", "app", "ops", "backup", "rotation"] as const;
export type RoleName = (typeof ROLES)[number];

export interface InstallationSecrets {
  superuserPassword: string;
  passwords: Record<RoleName, string>;
  betterAuthSecret: string;
  fieldEncryptionKeys: string;
  recovery: { identity: string; recipient: string };
}

/** Mots de passe en hexadécimal : jamais de caractère à échapper en SQL ni dans une URL. */
const hex = (bytes: number) => randomBytes(bytes).toString("hex");

export async function generateSecrets(): Promise<InstallationSecrets> {
  return {
    superuserPassword: hex(24),
    passwords: Object.fromEntries(ROLES.map((r) => [r, hex(24)])) as Record<RoleName, string>,
    betterAuthSecret: randomBytes(48).toString("base64url"),
    fieldEncryptionKeys: `v1:${randomBytes(32).toString("base64")}`,
    recovery: await generateRecoveryKey(),
  };
}

const HEX = /^[0-9a-f]{32,}$/;

/** Rôles et base, comme docker/postgres/init.sql, avec les mots de passe de cette installation. */
export function initSql(passwords: Record<RoleName, string>): string {
  for (const p of Object.values(passwords)) {
    if (!HEX.test(p)) throw new Error("mot de passe de rôle invalide");
  }
  return `
CREATE ROLE paiecam_owner LOGIN PASSWORD '${passwords.owner}';
CREATE ROLE paiecam_app LOGIN PASSWORD '${passwords.app}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE ROLE paiecam_ops LOGIN PASSWORD '${passwords.ops}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE ROLE paiecam_backup LOGIN PASSWORD '${passwords.backup}' NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT pg_read_all_data TO paiecam_backup;
CREATE ROLE paiecam_rotation LOGIN PASSWORD '${passwords.rotation}' NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE DATABASE paiecam OWNER paiecam_owner;
`;
}

export interface ClusterOptions {
  pgBinDir?: string | undefined;
  dataDir: string;
  port: number;
  /** Linux : compte système qui fait tourner PostgreSQL (Windows : service, sans objet). */
  runAs?: { uid: number; gid: number } | undefined;
}

export const dbUrl = (user: string, password: string, port: number, db = "paiecam") =>
  `postgres://${user}:${password}@127.0.0.1:${port}/${db}`;

/**
 * Crée le cluster : authentification SCRAM partout, écoute sur 127.0.0.1 seulement (aucun accès
 * depuis le réseau), et rien d'autre que les connexions TCP locales autorisées.
 */
export async function initCluster(opts: ClusterOptions & { superuserPassword: string }) {
  await mkdir(opts.dataDir, { recursive: true, mode: 0o700 });
  if (opts.runAs) await chown(opts.dataDir, opts.runAs.uid, opts.runAs.gid);
  const pwfile = join(opts.dataDir, "..", `.pw-${hex(8)}`);
  await writeFile(pwfile, opts.superuserPassword, { mode: 0o600 });
  if (opts.runAs) await chown(pwfile, opts.runAs.uid, opts.runAs.gid);
  try {
    await run(
      pgTool("initdb", opts.pgBinDir),
      [
        "-D",
        opts.dataDir,
        "-U",
        "postgres",
        "--auth=scram-sha-256",
        `--pwfile=${pwfile}`,
        "--encoding=UTF8",
        "--no-locale",
      ],
      { runAs: opts.runAs },
    );
  } finally {
    await rm(pwfile, { force: true });
  }
  await appendFile(
    join(opts.dataDir, "postgresql.conf"),
    `\n# PaieCam : installation locale\nlisten_addresses = '127.0.0.1'\nport = ${opts.port}\n# Pas de prise locale Unix : TCP sur 127.0.0.1 uniquement (sans objet sous Windows).\nunix_socket_directories = ''\n`,
  );
  await writeFile(
    join(opts.dataDir, "pg_hba.conf"),
    [
      "# PaieCam : uniquement depuis ce PC, mot de passe obligatoire",
      "host all all 127.0.0.1/32 scram-sha-256",
      "",
    ].join("\n"),
  );
}

export async function startCluster(opts: ClusterOptions) {
  await run(
    pgTool("pg_ctl", opts.pgBinDir),
    ["-D", opts.dataDir, "-l", join(opts.dataDir, "demarrage.log"), "-w", "start"],
    { runAs: opts.runAs, detachedOutput: true },
  );
}

export async function stopCluster(opts: ClusterOptions) {
  await run(pgTool("pg_ctl", opts.pgBinDir), ["-D", opts.dataDir, "-w", "-m", "fast", "stop"], {
    runAs: opts.runAs,
  });
}

/** Crée les rôles et la base de PaieCam (administrateur PostgreSQL). */
export async function createRolesAndDatabase(
  opts: ClusterOptions,
  secrets: InstallationSecrets,
): Promise<void> {
  await runPg(
    "psql",
    opts.pgBinDir,
    dbUrl("postgres", secrets.superuserPassword, opts.port, "postgres"),
    ["-v", "ON_ERROR_STOP=1", "-q", "-f", "-"],
    Buffer.from(initSql(secrets.passwords)),
  );
}

export interface InstallLayout {
  root: string;
  dataDir: string;
  documentsDir: string;
  backupDir: string;
  configFile: string;
  adminConfigFile: string;
  recoveryKitFile: string;
}

export function layout(root: string): InstallLayout {
  return {
    root,
    dataDir: join(root, "donnees", "base"),
    documentsDir: join(root, "donnees", "documents"),
    backupDir: join(root, "sauvegardes"),
    configFile: join(root, "config", "paiecam.env"),
    adminConfigFile: join(root, "config", "admin.env"),
    recoveryKitFile: join(root, "KIT-DE-RECUPERATION.txt"),
  };
}

/**
 * Chemins écrits avec « / » (acceptés par Node sous Windows) : une barre oblique inverse dans un
 * fichier .env peut être lue comme un échappement (« C:\nouveau » → retour à la ligne).
 */
const portablePath = (p: string) => p.replaceAll("\\", "/");

const envLine = (k: string, v: string | number) => {
  const value = String(v);
  if (/[\r\n"]/.test(value)) throw new Error(`valeur invalide pour ${k}`);
  return `${k}="${value}"`;
};

/** Configuration de l'application et du worker (lue au démarrage des services). */
export function appEnvFile(
  l: InstallLayout,
  s: InstallationSecrets,
  o: { port: number; appPort: number; pgBinDir?: string | undefined },
): string {
  const lines: [string, string | number][] = [
    ["NODE_ENV", "production"],
    ["DEPLOYMENT", "local"],
    // Une seule adresse, en IPv4 : sous Windows « localhost » peut viser ::1, où rien n'écoute.
    ["APP_URL", `http://127.0.0.1:${o.appPort}`],
    ["PORT", o.appPort],
    // Le serveur web n'écoute que sur ce PC.
    ["HOSTNAME", "127.0.0.1"],
    ["DATABASE_URL", dbUrl("paiecam_app", s.passwords.app, o.port)],
    ["BACKUP_DATABASE_URL", dbUrl("paiecam_backup", s.passwords.backup, o.port)],
    ["ROTATION_DATABASE_URL", dbUrl("paiecam_rotation", s.passwords.rotation, o.port)],
    ["BETTER_AUTH_SECRET", s.betterAuthSecret],
    ["FIELD_ENCRYPTION_KEYS", s.fieldEncryptionKeys],
    ["STORAGE_DRIVER", "fs"],
    ["DOCUMENTS_DIR", portablePath(l.documentsDir)],
    ["BACKUP_DIR", portablePath(l.backupDir)],
    ["BACKUP_RECIPIENT", s.recovery.recipient],
    ["PWNED_PASSWORDS_CHECK", "on"],
  ];
  if (o.pgBinDir) lines.push(["PG_BIN_DIR", portablePath(o.pgBinDir)]);
  return `# PaieCam — configuration de cette installation. Ne pas copier ni partager.\n${lines
    .map(([k, v]) => envLine(k, v))
    .join("\n")}\n`;
}

/** Accès d'administration (migrations, restauration) : réservé à l'outil d'administration. */
export function adminEnvFile(s: InstallationSecrets, o: { port: number }): string {
  return `# PaieCam — accès administrateur de la base. Ne pas copier ni partager.\n${[
    envLine("PG_SUPERUSER_URL", dbUrl("postgres", s.superuserPassword, o.port, "postgres")),
    envLine("MIGRATION_DATABASE_URL", dbUrl("paiecam_owner", s.passwords.owner, o.port)),
  ].join("\n")}\n`;
}

/** Le kit est la SEULE copie de la clé secrète : à imprimer, puis à retirer du PC. */
export function recoveryKit(s: InstallationSecrets, installedAt: Date): string {
  return `KIT DE RÉCUPÉRATION PAIECAM
===========================

Installation du ${installedAt.toLocaleDateString("fr-FR")}.

À IMPRIMER (ou à copier sur une clé USB), À RANGER EN LIEU SÛR, HORS DU BUREAU,
PUIS À SUPPRIMER DE CE PC.

Sans cette clé, les sauvegardes de PaieCam sont illisibles : si le PC tombe en
panne ou est volé, personne — pas même l'éditeur — ne pourra récupérer la paie.
Avec cette clé et une sauvegarde, n'importe qui peut lire toutes les données :
gardez-la comme les clés du coffre.

Clé de récupération (une seule ligne, à recopier exactement) :

${s.recovery.identity}

Restaurer sur un PC neuf :
  1. Installer PaieCam sur le nouveau PC.
  2. Copier le dernier fichier « paiecam-….sauvegarde » depuis la clé USB.
  3. Menu Démarrer > PaieCam > Restaurer une sauvegarde, puis saisir la clé ci-dessus.

Empreinte publique (pour vérification, non secrète) : ${s.recovery.recipient}
`;
}

export async function readEnvFile(path: string): Promise<Record<string, string>> {
  const { parseEnv } = await import("node:util");
  return parseEnv(await readFile(path, "utf8")) as Record<string, string>;
}

/** Remplace (ou ajoute) des variables dans un fichier de configuration. */
export async function updateEnvFile(path: string, values: Record<string, string>) {
  const lines = (await readFile(path, "utf8")).split(/\r?\n/);
  const seen = new Set<string>();
  const out = lines.map((line) => {
    const key = /^([A-Z0-9_]+)=/.exec(line)?.[1];
    if (key && key in values) {
      seen.add(key);
      return envLine(key, values[key] ?? "");
    }
    return line;
  });
  for (const [k, v] of Object.entries(values)) if (!seen.has(k)) out.splice(-1, 0, envLine(k, v));
  await writeFile(path, out.join("\n"), { mode: 0o600 });
}
