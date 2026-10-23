import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Base de test remise à zéro avant chaque fichier : aucun fichier ne dépend d'un autre.
    setupFiles: ["./test/reset-db.ts"],
    // Les fichiers partagent la même base : pas d'exécution en parallèle.
    fileParallelism: false,
  },
});
