import { expect, test } from "./fixtures";
import { totp } from "./totp";

const email = `proprietaire.fictif.${Date.now()}@exemple.test`;
const password = "une phrase de passe assez longue";

test("une page protégée renvoie vers la connexion", async ({ page }) => {
  await page.goto("/tableau-de-bord");
  await expect(page).toHaveURL(/\/connexion$/);
});

test("inscription → entreprise → 2FA → tableau de bord → reconnexion avec 2FA", async ({
  page,
}) => {
  // Inscription
  await page.goto("/inscription");
  await page.getByLabel("Nom complet").fill("Propriétaire Fictif");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page).toHaveURL(/\/entreprise\/nouvelle$/);

  // Le tableau de bord reste fermé tant qu'aucune entreprise n'est choisie
  await page.goto("/tableau-de-bord");
  await expect(page).toHaveURL(/\/entreprise\/nouvelle$/);

  // Entreprise
  await page.getByLabel("Raison sociale").fill("Boulangerie Fictive SARL");
  await page.getByLabel("NIU").fill("M000000000001X");
  await page.getByLabel("N° employeur CNPS").fill("000-0000000-A");
  await page.getByLabel("Commune").fill("Douala 3e");
  await page.getByRole("button", { name: "Créer l'entreprise" }).click();
  await expect(page).toHaveURL(/\/securite\/2fa$/);

  // Sans 2FA, le propriétaire est renvoyé vers l'activation
  await page.goto("/tableau-de-bord");
  await expect(page).toHaveURL(/\/securite\/2fa$/);

  // Activation de la 2FA
  await page.getByLabel("Confirmez votre mot de passe").fill(password);
  await page.getByRole("button", { name: "Commencer" }).click();
  const secret = (await page.locator("code").textContent())?.trim() ?? "";
  expect(secret).toMatch(/^[A-Z2-7]+=*$/);
  await expect(page.locator("ul li")).toHaveCount(10);
  await page.getByLabel("Code").fill(totp(secret));
  await page.getByRole("button", { name: "Activer" }).click();
  await expect(page).toHaveURL(/\/tableau-de-bord$/);
  await expect(page.getByRole("heading", { name: "Boulangerie Fictive SARL" })).toBeVisible();
  await expect(page.getByText("Votre rôle : Propriétaire")).toBeVisible();

  // Déconnexion puis reconnexion : la 2FA est demandée
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page).toHaveURL(/\/connexion$/);
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/connexion\/2fa$/);
  await page.getByLabel("Code").fill(totp(secret, 1));
  await page.getByRole("button", { name: "Valider" }).click();

  // Le cookie d'entreprise peut avoir survécu à la déconnexion ; sinon on choisit l'entreprise.
  await page.waitForURL(/\/(tableau-de-bord|choisir-entreprise)$/);
  if (page.url().endsWith("/choisir-entreprise")) {
    await page.getByRole("button", { name: /Boulangerie Fictive SARL/ }).click();
  }
  await expect(page.getByRole("heading", { name: "Boulangerie Fictive SARL" })).toBeVisible();

  // Interface en anglais
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByText("Your role: Owner")).toBeVisible();
});

test("un mauvais mot de passe affiche un message sans détail", async ({ page }) => {
  await page.goto("/connexion");
  await page.getByLabel("Adresse e-mail").fill("inconnu@exemple.test");
  await page.getByLabel("Mot de passe").fill("mauvais mot de passe");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByText("Adresse e-mail ou mot de passe incorrect.")).toBeVisible();
});
