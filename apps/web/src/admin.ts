/**
 * Outil d'administration de l'installation locale (raccourcis du menu Démarrer sous Windows).
 *
 *   paiecam-admin install  --dossier <d> --pg-bin <d> --migrations <d> --referentiel <f>
 *   paiecam-admin update   --dossier <d> --migrations <d> --referentiel <f>
 *   paiecam-admin restore  --dossier <d> --fichier <sauvegarde>   (clé saisie au clavier)
 *   paiecam-admin backup   --dossier <d>
 *   paiecam-admin reset-password --dossier <d> --email <adresse>
 *   paiecam-admin reset-2fa      --dossier <d> --email <adresse>
 *
 * La clé de récupération n'est jamais passée en argument (historique, liste des processus).
 */
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { createDb } from "@paiecam/db";
import { installLocal, layout, readEnvFile, restoreLocal, updateLocal } from "@paiecam/local";
import { loadRuleFile } from "@paiecam/paie-engine/rules";
import { parseEnv } from "./env-schema";
import { resetPassword, resetTwoFactor } from "./server/admin/accounts";
import { runLocalBackup } from "./server/jobs/local-backup";
import { APP_VERSION } from "./version";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    dossier: { type: "string" },
    "pg-bin": { type: "string" },
    migrations: { type: "string" },
    referentiel: { type: "string" },
    fichier: { type: "string" },
    email: { type: "string" },
    port: { type: "string" },
    "port-web": { type: "string" },
  },
});

function need(name: keyof typeof values): string {
  const v = values[name];
  if (typeof v !== "string" || v === "") {
    console.error(`Option manquante : --${name}`);
    process.exit(64);
  }
  return v;
}

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/** Configuration de l'application de cette installation, validée comme au démarrage. */
async function appEnv(root: string) {
  return parseEnv(await readEnvFile(layout(root).configFile));
}

async function withAppDb<T>(root: string, fn: (db: ReturnType<typeof createDb>) => Promise<T>) {
  const db = createDb((await appEnv(root)).DATABASE_URL);
  try {
    return await fn(db);
  } finally {
    await db.$client.end();
  }
}

const command = positionals[0];
const root = need("dossier");

switch (command) {
  case "install": {
    const res = await installLocal({
      root,
      pgBinDir: need("pg-bin"),
      migrationsFolder: need("migrations"),
      rules: loadRuleFile(need("referentiel")),
      port: Number(values.port ?? 5433),
      appPort: Number(values["port-web"] ?? 3000),
    });
    console.warn(
      `PaieCam est installé. IMPRIMEZ le kit de récupération puis supprimez-le du PC :\n  ${res.layout.recoveryKitFile}`,
    );
    break;
  }
  case "update": {
    const res = await updateLocal({
      root,
      migrationsFolder: need("migrations"),
      rules: loadRuleFile(need("referentiel")),
      appVersion: APP_VERSION,
    });
    console.warn(
      `Sauvegarde : ${res.backup.name}. Référentiel : ${res.rules.loaded} règle(s) mises à jour, ${res.rules.skipped} validée(s) intactes.`,
    );
    break;
  }
  case "restore": {
    const identity = await ask("Clé de récupération (AGE-SECRET-KEY-1…) : ");
    await restoreLocal({ root, file: need("fichier"), identity });
    console.warn("Restauration terminée. Redémarrez les services PaieCam.");
    break;
  }
  case "backup": {
    const b = await runLocalBackup(await appEnv(root));
    console.warn(`Sauvegarde créée : ${b.path}`);
    break;
  }
  case "reset-password": {
    const password = await withAppDb(root, (db) => resetPassword(db, need("email")));
    console.warn(
      `Mot de passe provisoire (à communiquer en main propre, puis à changer) :\n  ${password}`,
    );
    break;
  }
  case "reset-2fa": {
    await withAppDb(root, (db) => resetTwoFactor(db, need("email")));
    console.warn(
      "Double authentification retirée : elle sera redemandée à la prochaine connexion.",
    );
    break;
  }
  default:
    console.error(
      "Commandes : install, update, restore, backup, reset-password, reset-2fa (voir l'en-tête du fichier).",
    );
    process.exit(64);
}
