import { expect, type Page } from "@playwright/test";
import { totp } from "./totp";

export const PASSWORD = "une phrase de passe assez longue";
let n = 0;
export const uniqueEmail = (prefix: string) => `${prefix}.${Date.now()}.${++n}@exemple.test`;

export async function signUp(page: Page, email: string, name = "Utilisateur Fictif") {
  await page.getByLabel("Nom complet").fill(name);
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Créer mon compte" }).click();
}

/** Crée un propriétaire avec son entreprise et la 2FA active ; renvoie le secret TOTP. */
export async function ownerWithCompany(page: Page, email: string, company: string, niu: string) {
  await page.goto("/inscription");
  await signUp(page, email, "Propriétaire Fictif");
  await expect(page).toHaveURL(/\/entreprise\/nouvelle$/);
  await page.getByLabel("Raison sociale").fill(company);
  await page.getByLabel("NIU").fill(niu);
  await page.getByLabel("N° employeur CNPS").fill("000-0000000-A");
  await page.getByLabel("Commune").fill("Douala 3e");
  await page.getByRole("button", { name: "Créer l'entreprise" }).click();
  await expect(page).toHaveURL(/\/securite\/2fa$/);
  await page.getByLabel("Confirmez votre mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Commencer" }).click();
  await expect(page.locator("code")).toBeVisible();
  const secret = (await page.locator("code").textContent())?.trim() ?? "";
  await page.getByLabel("Code").fill(totp(secret));
  await page.getByRole("button", { name: "Activer" }).click();
  await expect(page.getByRole("heading", { name: company })).toBeVisible();
  return secret;
}
