import { expect, test } from "./fixtures";

test("pages légales publiques, marquées comme projets, liées depuis le pied de page", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Confidentialité" }).click();
  await expect(page).toHaveURL(/\/confidentialite$/);
  await expect(page.getByRole("heading", { name: "Politique de confidentialité" })).toBeVisible();
  await expect(page.getByRole("note")).toContainText("relecture juridique");
  for (const [path, title] of [
    ["/mentions-legales", "Mentions légales"],
    ["/conditions", "Conditions générales d'utilisation"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
  }
});

test("security.txt conforme à la RFC 9116", async ({ request }) => {
  const res = await request.get("/.well-known/security.txt");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/plain");
  const body = await res.text();
  expect(body).toContain("Contact: mailto:securite@exemple.test");
  const expires = /Expires: (\S+)/.exec(body)?.[1] ?? "";
  expect(new Date(expires).getTime()).toBeGreaterThan(Date.now());
  expect(body).toMatch(/Canonical: http:\/\/localhost:\d+\/\.well-known\/security\.txt/);
});
