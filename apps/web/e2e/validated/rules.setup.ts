import { test as setup } from "@playwright/test";
import { validateAllTestRules } from "@paiecam/db/testing";

setup("l'expert-comptable valide le référentiel (base de test)", async () => {
  await validateAllTestRules();
});
