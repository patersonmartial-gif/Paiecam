// Regroupe le worker et l'outil d'administration en fichiers autonomes pour l'installation locale.
// Usage : node scripts/windows/bundle.mjs <dossier de sortie>
// Seul le module natif Argon2 reste externe : il est copié à côté (binaire propre à la plateforme).
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = resolve(process.argv[2] ?? join(repo, "dist", "outils"));
await mkdir(out, { recursive: true });

await build({
  absWorkingDir: join(repo, "apps/web"),
  entryPoints: { worker: "src/worker.ts", admin: "src/admin.ts" },
  outdir: out,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  tsconfig: join(repo, "apps/web/tsconfig.json"),
  jsx: "automatic",
  external: ["@node-rs/argon2", "@node-rs/argon2-*"],
  // Modules CommonJS regroupés en ESM : require() doit exister.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: "warning",
});

// Migrations et référentiel livrés avec la version (chemins passés à paiecam-admin).
await cp(join(repo, "packages/db/drizzle"), join(out, "migrations"), { recursive: true });
await mkdir(join(out, "referentiel"), { recursive: true });
await cp(
  join(repo, "packages/paie-engine/rules/cm-2026.draft.json"),
  join(out, "referentiel", "cm-2026.json"),
);
await cp(join(repo, "scripts/windows/launch.mjs"), join(out, "launch.mjs"));

// Polices standard de pdfkit (bulletins PDF) : chargées à l'exécution par un require
// « #standard-fonts/<nom> » que le regroupement ne peut pas suivre. On les livre à côté du worker
// et on déclare le même chemin interne dans le package.json du dossier des outils.
const fromRenderer = createRequire(
  createRequire(join(repo, "packages/documents/package.json")).resolve("@react-pdf/renderer"),
);
// pdfkit n'exporte pas son package.json : on remonte depuis son point d'entrée.
let pdfkit = dirname(fromRenderer.resolve("pdfkit"));
while (!existsSync(join(pdfkit, "package.json"))) pdfkit = dirname(pdfkit);
await cp(join(pdfkit, "js/standard-fonts"), join(out, "standard-fonts"), { recursive: true });
await cp(join(pdfkit, "js/data"), join(out, "data"), { recursive: true });
await writeFile(
  join(out, "package.json"),
  JSON.stringify({ type: "module", imports: { "#standard-fonts/*": "./standard-fonts/*.cjs" } }),
);
// Auto-contrôle : le code regroupé produit bien un bulletin PDF (polices comprises).
await build({
  absWorkingDir: join(repo, "apps/web"),
  entryPoints: { "pdf-selftest": join(repo, "scripts/windows/pdf-selftest.ts") },
  nodePaths: [join(repo, "apps/web/node_modules")],
  outdir: out,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  jsx: "automatic",
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: "warning",
});
const selftest = join(out, "pdf-selftest.mjs");
execFileSync(process.execPath, [selftest], { cwd: out, stdio: "inherit" });
await rm(selftest);
console.log(`Outils regroupés dans ${out}`);
