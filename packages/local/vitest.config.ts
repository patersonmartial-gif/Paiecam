import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Base de test partagée avec les autres paquets : pas d'exécution en parallèle.
    fileParallelism: false,
    coverage: { provider: "v8", include: ["src/**"], exclude: ["src/index.ts"] },
  },
});
