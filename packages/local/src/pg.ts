import { spawn } from "node:child_process";
import { join } from "node:path";

/** Chemin d'un outil PostgreSQL (livré avec PaieCam sous Windows, sinon dans le PATH). */
export const pgTool = (bin: string, pgBinDir?: string) =>
  pgBinDir ? join(pgBinDir, process.platform === "win32" ? `${bin}.exe` : bin) : bin;

/** Exécute un programme et renvoie sa sortie ; échoue avec son message d'erreur. */
export function run(
  exe: string,
  args: string[],
  options: {
    env?: Record<string, string | undefined>;
    input?: Uint8Array;
    /** Linux/macOS : utilisateur système non privilégié (initdb refuse root). */
    runAs?: { uid: number; gid: number } | undefined;
    /**
     * Programme qui lance un serveur durable (pg_ctl start) : sous Windows, le serveur hérite des
     * canaux de sortie et les garde ouverts. On n'en lit rien et on attend la seule fin du
     * programme lancé ; ses messages vont dans son propre fichier journal.
     */
    detachedOutput?: boolean;
  } = {},
): Promise<Buffer> {
  if (options.detachedOutput) {
    return new Promise((resolve, reject) => {
      const child = spawn(exe, args, {
        env: { ...process.env, ...options.env },
        stdio: "ignore",
        ...(options.runAs ?? {}),
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) resolve(Buffer.alloc(0));
        else reject(new Error(`${exe} a échoué (${code}) : voir son fichier journal`));
      });
    });
  }
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
      ...(options.runAs ?? {}),
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => err.push(d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`${exe} a échoué (${code}) : ${Buffer.concat(err).toString().trim()}`));
    });
    child.stdin.end(options.input ?? Buffer.alloc(0));
  });
}

/** Lance un outil PostgreSQL ; le mot de passe passe par PGPASSWORD, jamais par la ligne de commande. */
export function runPg(
  bin: string,
  pgBinDir: string | undefined,
  url: string,
  args: string[],
  input?: Uint8Array,
): Promise<Buffer> {
  const u = new URL(url);
  const password = decodeURIComponent(u.password);
  u.password = "";
  return run(pgTool(bin, pgBinDir), [`--dbname=${u.toString()}`, ...args], {
    env: { PGPASSWORD: password },
    ...(input ? { input } : {}),
  });
}
