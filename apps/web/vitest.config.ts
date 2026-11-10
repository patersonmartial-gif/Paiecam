import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    // Base de test remise à zéro avant chaque fichier : aucun fichier ne dépend d'un autre.
    setupFiles: ["./test/reset-db.ts"],
    fileParallelism: false,
    // Les parcours Playwright tournent avec `test:e2e`, pas avec Vitest.
    exclude: ["e2e/**", "node_modules/**"],
  },
});
