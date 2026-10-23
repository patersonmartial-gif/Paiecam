import { test as base, expect } from "@playwright/test";
import { createDb, sql } from "@paiecam/db";
import { testDatabaseUrl } from "@paiecam/db/testing";

/**
 * - resetRateLimits : tous les parcours viennent de la même IP locale ; on vide les compteurs
 *   (limites et verrouillages) avant chaque test.
 * - cspGuard : tout blocage par la CSP dans la console du navigateur fait échouer le test.
 */
export const test = base.extend<{ resetRateLimits: undefined; cspGuard: undefined }>({
  resetRateLimits: [
    // Syntaxe imposée par Playwright pour une fixture sans dépendance.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const db = createDb(testDatabaseUrl());
      await db.execute(sql`delete from rate_limits`);
      await db.execute(sql`delete from login_lockouts`);
      await db.$client.end();
      await use(undefined);
    },
    { auto: true },
  ],
  cspGuard: [
    async ({ page }, use) => {
      const violations: string[] = [];
      page.on("console", (msg) => {
        const text = msg.text();
        if (/Content Security Policy|Refused to (load|execute|apply|connect|frame)/i.test(text))
          violations.push(text);
      });
      await use(undefined);
      expect(violations, "violations de la CSP").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
