import { defineConfig, devices } from "@playwright/test";
import { OUTBOX } from "./e2e/outbox";
import { fileURLToPath } from "node:url";

try {
  process.loadEnvFile("../../.env");
} catch {
  // en CI, les variables viennent de l'environnement
}

const PORT = 3200;
const baseURL = `http://localhost:${PORT}`;

/** Environnement commun au serveur web et au worker : base de test, stockage et e-mails jetables. */
const env = {
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
  APP_URL: baseURL,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "e2e-secret-e2e-secret-e2e-secret-32",
  PWNED_PASSWORDS_CHECK: "off",
  MAIL_OUTBOX_DIR: OUTBOX,
  SECURITY_CONTACT: "mailto:securite@exemple.test",
  DOCUMENTS_DIR: fileURLToPath(new URL("./.e2e-documents", import.meta.url)),
  FIELD_ENCRYPTION_KEYS:
    process.env.FIELD_ENCRYPTION_KEYS ?? `v1:${Buffer.alloc(32, 7).toString("base64")}`,
};

/**
 * Parcours de bout en bout sur la base de test (jamais la base de développement).
 * 1. « provisoire » : référentiel en brouillon, bulletins provisoires.
 * 2. « règles validées » : les règles sont validées, puis une paie est validée de bout en bout
 *    (worker, PDF, téléchargement, vérification). Une règle validée ne redevient jamais brouillon,
 *    d'où cet ordre imposé par les dépendances.
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  // next dev compile chaque page à la première visite.
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  },
  projects: [
    { name: "provisoire", testIgnore: /validated\// },
    {
      name: "validation-des-regles",
      testMatch: /validated\/rules\.setup\.ts/,
      dependencies: ["provisoire"],
    },
    {
      name: "regles-validees",
      testMatch: /validated\/.*\.spec\.ts/,
      dependencies: ["validation-des-regles"],
    },
  ],
  webServer: [
    {
      command: `next dev -p ${PORT}`,
      url: baseURL,
      reuseExistingServer: false,
      timeout: 120_000,
      env,
    },
    {
      command: "tsx src/worker.ts",
      wait: { stdout: /worker démarré/ },
      reuseExistingServer: false,
      timeout: 60_000,
      env,
    },
  ],
});
