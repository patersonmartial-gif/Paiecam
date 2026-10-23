import { test as base } from "@playwright/test";
import { createDb, sql } from "@paiecam/db";
import { testDatabaseUrl } from "@paiecam/db/testing";

/**
 * Tous les parcours viennent de la même IP locale : on vide les compteurs de limitation
 * avant chaque test, pour que la limite d'inscriptions (3/min) ne fasse pas échouer le suivant.
 */
export const test = base.extend<{ resetRateLimits: undefined }>({
  resetRateLimits: [
    // Syntaxe imposée par Playwright pour une fixture sans dépendance.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const db = createDb(testDatabaseUrl());
      await db.execute(sql`delete from rate_limits`);
      await db.$client.end();
      await use(undefined);
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";
