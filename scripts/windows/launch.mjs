// Lanceur des services PaieCam : charge la configuration de l'installation, puis démarre le
// serveur web ou le worker. Les secrets restent dans le fichier de configuration (droits
// restreints), jamais dans la définition du service.
//   node launch.mjs web    <config> <server.js>
//   node launch.mjs worker <config> <worker.mjs>
import { pathToFileURL } from "node:url";

const [, , kind, config, entry] = process.argv;
if (!["web", "worker"].includes(kind ?? "") || !config || !entry) {
  console.error("usage : node launch.mjs web|worker <fichier de configuration> <point d'entrée>");
  process.exit(64);
}
process.loadEnvFile(config);
await import(pathToFileURL(entry).href);
