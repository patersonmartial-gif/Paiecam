import { defineConfig, devices } from "@playwright/test";

try {
  process.loadEnvFile("../../.env");
} catch {
  // en CI, les variables viennent de l'environnement
}

const PORT = 3200;
const baseURL = `http://localhost:${PORT}`;

/** Parcours de bout en bout sur la base de test (jamais la base de développement). */
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
  webServer: {
    command: `next dev -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
      APP_URL: baseURL,
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "e2e-secret-e2e-secret-e2e-secret-32",
      PWNED_PASSWORDS_CHECK: "off",
      FIELD_ENCRYPTION_KEYS:
        process.env.FIELD_ENCRYPTION_KEYS ?? `v1:${Buffer.alloc(32, 7).toString("base64")}`,
    },
  },
});
