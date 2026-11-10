import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Base de test partagée avec les autres paquets : pas d'exécution en parallèle.
    fileParallelism: false,
    setupFiles: ["./test/reset-db.ts"],
    coverage: { provider: "v8", include: ["src/**"], exclude: ["src/index.ts"] },
  },
});
