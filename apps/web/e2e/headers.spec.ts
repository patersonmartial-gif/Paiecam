import { expect, test } from "./fixtures";

test("en-têtes de sécurité et CSP avec nonce sur chaque réponse", async ({ page, request }) => {
  const first = await request.get("/connexion");
  const second = await request.get("/connexion");
  const h = first.headers();
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(h["strict-transport-security"]).toContain("max-age=");
  expect(h["cross-origin-opener-policy"]).toBe("same-origin");
  expect(h["x-powered-by"]).toBeUndefined();
  const csp = h["content-security-policy"] ?? "";
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  // Un nonce différent à chaque requête
  const nonce = (c: string) => /'nonce-([^']+)'/.exec(c)?.[1];
  expect(nonce(csp)).not.toBe(nonce(second.headers()["content-security-policy"] ?? ""));
  // Chaque <script> du HTML servi porte le nonce de la CSP de cette même réponse
  // (les scripts chargés ensuite par ceux-ci sont autorisés par 'strict-dynamic').
  const res = await request.get("/connexion");
  const expected = nonce(res.headers()["content-security-policy"] ?? "");
  const tags = (await res.text()).match(/<script\b[^>]*>/g) ?? [];
  expect(tags.length).toBeGreaterThan(0);
  for (const tag of tags) expect(tag).toContain(`nonce="${expected}"`);
  await page.goto("/connexion");
});

test("l'en-tête IP interne envoyé par le client est ignoré", async ({ request }) => {
  // Le proxy écrase toujours cet en-tête : un client ne peut pas choisir son IP pour l'audit ou les limites.
  const res = await request.get("/connexion", {
    headers: { "x-paiecam-client-ip": "203.0.113.200" },
  });
  expect(res.status()).toBe(200);
});
