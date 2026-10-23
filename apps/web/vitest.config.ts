import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  test: {
    // Base de test remise à zéro avant chaque fichier : aucun fichier ne dépend d'un autre.
    setupFiles: ["./test/reset-db.ts"],
    fileParallelism: false,
    // Les parcours Playwright tournent avec `test:e2e`, pas avec Vitest.
    exclude: ["e2e/**", "node_modules/**"],
  },
});
