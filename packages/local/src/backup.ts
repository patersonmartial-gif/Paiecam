/**
 * Sauvegarde et restauration de l'installation locale (Windows comme Linux, sans bash).
 *
 * Une sauvegarde est UN fichier « paiecam-AAAA-MM-JJ-HHMMSS.sauvegarde » chiffré avec age
 * (clé publique X25519) : une archive contenant la base (pg_dump), les documents et les secrets
 * de l'installation (clés de chiffrement des champs, secret des sessions et de la 2FA). Avec la
 * seule clé secrète du kit de récupération, on remonte tout sur un PC neuf.
 *
 * Tout est en mémoire : adapté au volume d'une PME (quelques dizaines de Mo) ; à passer en flux
 * si les volumes grossissent.
 */
import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, normalize, relative, sep } from "node:path";
import { Decrypter, Encrypter } from "age-encryption";
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";

export const BACKUP_FORMAT = 1;
const NAME = /^paiecam-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})\.sauvegarde$/;
/** Même règle que les clés du stockage des documents : pas de chemin qui sort du dossier. */
const SAFE_DOC = /^[a-z0-9][a-z0-9/_.-]{0,200}$/;

export interface BackupManifest {
  format: number;
  createdAt: string;
  appVersion: string;
  documents: number;
}

export interface BackupConfig {
  /** Dossier de pg_dump / pg_restore (livrés avec PaieCam sous Windows) ; vide = dans le PATH. */
  pgBinDir?: string | undefined;
  /** Rôle paiecam_backup (lecture seule, exempté du RLS). */
  databaseUrl: string;
  documentsDir: string;
  backupDir: string;
  /** Clé publique age (age1…) du kit de récupération. */
  recipient: string;
  /** Secrets de l'installation, restaurés avec les données. */
  secrets: Record<string, string>;
  appVersion: string;
  /** Nombre de sauvegardes conservées dans le dossier (les plus anciennes sont supprimées). */
  keep?: number;
  now?: Date;
}

/** Lance un outil PostgreSQL ; le mot de passe passe par PGPASSWORD, jamais par la ligne de commande. */
function runPg(
  bin: string,
  pgBinDir: string | undefined,
  url: string,
  args: string[],
  input?: Uint8Array,
): Promise<Buffer> {
  const u = new URL(url);
  const password = decodeURIComponent(u.password);
  u.password = "";
  const exe = pgBinDir ? join(pgBinDir, process.platform === "win32" ? `${bin}.exe` : bin) : bin;
  return new Promise((resolve, reject) => {
    const child = spawn(exe, [`--dbname=${u.toString()}`, ...args], {
      env: { ...process.env, PGPASSWORD: password },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => err.push(d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`${bin} a échoué (${code}) : ${Buffer.concat(err).toString().trim()}`));
    });
    child.stdin.end(input ?? Buffer.alloc(0));
  });
}

async function walk(dir: string, root = dir, out: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return out;
    throw e;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, root, out);
    else if (e.isFile()) out.push(relative(root, p).split(sep).join("/"));
  }
  return out;
}

const stamp = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

export interface BackupFile {
  name: string;
  path: string;
  sizeBytes: number;
  createdAt: Date;
}

/** Sauvegardes présentes dans le dossier, la plus récente d'abord. */
export async function listBackups(backupDir: string): Promise<BackupFile[]> {
  let names: string[];
  try {
    names = await readdir(backupDir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const files: BackupFile[] = [];
  for (const name of names) {
    const m = NAME.exec(name);
    if (!m) continue;
    const [, y, mo, d, h, mi, s] = m.map(Number) as number[];
    const path = join(backupDir, name);
    files.push({
      name,
      path,
      sizeBytes: (await stat(path)).size,
      createdAt: new Date(y ?? 0, (mo ?? 1) - 1, d, h, mi, s),
    });
  }
  return files.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function createBackup(cfg: BackupConfig): Promise<BackupFile> {
  const now = cfg.now ?? new Date();
  // Les tâches pg-boss sont transitoires : structure sauvegardée, contenu exclu.
  const dump = await runPg("pg_dump", cfg.pgBinDir, cfg.databaseUrl, [
    "--format=custom",
    "--compress=6",
    "--exclude-table-data=pgboss.*",
  ]);
  const docs = await walk(cfg.documentsDir);
  const files: Zippable = {};
  for (const d of docs) files[`documents/${d}`] = await readFile(join(cfg.documentsDir, d));
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    createdAt: now.toISOString(),
    appVersion: cfg.appVersion,
    documents: docs.length,
  };
  files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
  files["secrets.json"] = strToU8(JSON.stringify(cfg.secrets));
  // La base est déjà compressée par pg_dump, les PDF le sont aussi : pas de recompression.
  files["db.dump"] = [new Uint8Array(dump), { level: 0 }];
  const zip = zipSync(files, { level: 0 });

  const enc = new Encrypter();
  enc.addRecipient(cfg.recipient);
  const encrypted = await enc.encrypt(zip);

  await mkdir(cfg.backupDir, { recursive: true });
  const name = `paiecam-${stamp(now)}.sauvegarde`;
  const path = join(cfg.backupDir, name);
  // Écriture à côté puis renommage : jamais de sauvegarde à moitié écrite sous le nom final.
  const tmp = `${path}.partiel`;
  await writeFile(tmp, encrypted, { flag: "wx" });
  await rename(tmp, path);

  const all = await listBackups(cfg.backupDir);
  for (const old of all.slice(cfg.keep ?? 30)) await rm(old.path);
  return { name, path, sizeBytes: encrypted.length, createdAt: now };
}

export interface OpenedBackup {
  manifest: BackupManifest;
  secrets: Record<string, string>;
  dump: Uint8Array;
  documents: Map<string, Uint8Array>;
}

/** Déchiffre et vérifie une sauvegarde (clé secrète du kit de récupération). */
export async function openBackup(file: string, identity: string): Promise<OpenedBackup> {
  const dec = new Decrypter();
  dec.addIdentity(identity.trim());
  let zip: Uint8Array;
  try {
    zip = await dec.decrypt(new Uint8Array(await readFile(file)));
  } catch {
    // age authentifie le contenu : clé incorrecte ou fichier altéré.
    throw new Error("sauvegarde illisible : clé de récupération incorrecte ou fichier altéré");
  }
  const entries = unzipSync(zip);
  const manifestRaw = entries["manifest.json"];
  const secretsRaw = entries["secrets.json"];
  const dump = entries["db.dump"];
  if (!manifestRaw || !secretsRaw || !dump) throw new Error("sauvegarde incomplète");
  const manifest = JSON.parse(strFromU8(manifestRaw)) as BackupManifest;
  if (manifest.format !== BACKUP_FORMAT) {
    throw new Error(`format de sauvegarde ${manifest.format} non pris en charge`);
  }
  const documents = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(entries)) {
    if (!name.startsWith("documents/")) continue;
    const key = name.slice("documents/".length);
    if (!SAFE_DOC.test(key) || key.includes("..") || normalize(key) !== key.split("/").join(sep))
      throw new Error("sauvegarde refusée : chemin de document invalide");
    documents.set(key, data);
  }
  if (documents.size !== manifest.documents) throw new Error("sauvegarde incomplète");
  return {
    manifest,
    secrets: JSON.parse(strFromU8(secretsRaw)) as Record<string, string>,
    dump,
    documents,
  };
}

export interface RestoreConfig {
  file: string;
  identity: string;
  /** Administrateur PostgreSQL sur une base VIDE (rôles déjà créés). */
  adminDatabaseUrl: string;
  /** Dossier des documents : absent ou vide. */
  documentsDir: string;
  pgBinDir?: string | undefined;
}

/**
 * Restaure dans une base vide et un dossier vide ; renvoie les secrets à remettre dans la
 * configuration. Refuse d'écraser quoi que ce soit.
 */
export async function restoreBackup(cfg: RestoreConfig): Promise<OpenedBackup["secrets"]> {
  const backup = await openBackup(cfg.file, cfg.identity);
  const tables = (
    await runPg("psql", cfg.pgBinDir, cfg.adminDatabaseUrl, [
      "-Atqc",
      "select count(*) from pg_tables where schemaname not in ('pg_catalog','information_schema')",
    ])
  )
    .toString()
    .trim();
  if (tables !== "0") throw new Error(`refus : la base cible n'est pas vide (${tables} tables)`);
  if ((await walk(cfg.documentsDir)).length > 0) {
    throw new Error("refus : le dossier des documents n'est pas vide");
  }
  await runPg(
    "pg_restore",
    cfg.pgBinDir,
    cfg.adminDatabaseUrl,
    ["--single-transaction", "--exit-on-error", "--clean", "--if-exists"],
    backup.dump,
  );
  for (const [key, data] of backup.documents) {
    const path = join(cfg.documentsDir, ...key.split("/"));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data, { flag: "wx" });
  }
  return backup.secrets;
}
