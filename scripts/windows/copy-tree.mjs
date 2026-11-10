// Copie un dossier en remplaçant chaque lien symbolique par son contenu réel.
// Sous Windows, le build autonome de Next.js garde les liens de pnpm, dont certains pointent
// vers des paquets non retenus par le traçage : ces liens cassés sont ignorés (et listés).
// Usage : node scripts/windows/copy-tree.mjs <source> <destination>
import { copyFileSync, lstatSync, mkdirSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";

const [, , src, dst] = process.argv;
if (!src || !dst) {
  console.error("usage : node copy-tree.mjs <source> <destination>");
  process.exit(64);
}
const skipped = [];
let files = 0;

function copy(from, to) {
  let real = from;
  if (lstatSync(from).isSymbolicLink()) {
    try {
      real = realpathSync(from);
    } catch {
      skipped.push(from);
      return;
    }
  }
  if (statSync(real).isDirectory()) {
    mkdirSync(to, { recursive: true });
    for (const name of readdirSync(real)) copy(join(real, name), join(to, name));
  } else {
    copyFileSync(real, to);
    files++;
  }
}

copy(src, dst);
console.warn(`${files} fichiers copiés vers ${dst}`);
if (skipped.length)
  console.warn(`liens cassés ignorés (${skipped.length}) :\n  ${skipped.join("\n  ")}`);
