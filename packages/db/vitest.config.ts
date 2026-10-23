import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    // Les fichiers partagent la même base : pas d'exécution en parallèle.
    fileParallelism: false,
  },
});
