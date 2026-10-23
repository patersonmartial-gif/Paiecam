import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { ownerWithCompany, PASSWORD, uniqueEmail } from "./helpers";

async function fillEmployee(page: Page) {
  await page.getByLabel("Matricule").fill("E-001");
  await page.getByLabel("Nom", { exact: true }).fill("Fictif");
  await page.getByLabel("Prénoms").fill("Jean");
  await page.getByLabel("Date de naissance").fill("1990-05-01");
  await page.getByLabel("N° CNPS").fill("198765432");
  await page.getByLabel("Date d'embauche").fill("2024-01-15");
  await page.getByLabel("Poste").fill("Vendeur");
  await page.getByLabel("Catégorie").fill("4");
  await page.getByLabel("Échelon").fill("B");
  await page.getByLabel("Salaire de base (FCFA/mois)").fill("185000");
  await page.getByLabel("Situation familiale").selectOption("married");
  await page.getByLabel("Enfants à charge").fill("2");
}

test("créer un salarié, saisir son IBAN, l'afficher en clair puis enregistrer sa sortie", async ({
  page,
}) => {
  await ownerWithCompany(page, uniqueEmail("proprio-sal"), "Pharmacie Fictive", "M000000000020P");

  await page.getByRole("link", { name: "Salariés" }).click();
  await expect(page.getByText("Aucun salarié pour l'instant.")).toBeVisible();
  await page.getByRole("link", { name: "Ajouter un salarié" }).click();
  await fillEmployee(page);
  await page.getByRole("button", { name: "Créer la fiche" }).click();
  await expect(page.getByRole("heading", { name: "Fictif Jean" })).toBeVisible();
  await expect(page.getByText("•••• 5432")).toBeVisible();

  // Coordonnées : le mot de passe est exigé
  await page.getByLabel("IBAN").fill("CM21 1000 2000 3002 7797 6315 008");
  await page.getByLabel("Votre mot de passe").fill("mauvais mot de passe");
  await page.getByRole("button", { name: "Enregistrer les coordonnées" }).click();
  await expect(page.getByText("Mot de passe incorrect.")).toBeVisible();
  await page.getByLabel("IBAN").fill("CM21 1000 2000 3002 7797 6315 008");
  await page.getByLabel("Votre mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Enregistrer les coordonnées" }).click();
  await expect(page.getByText("•••• 5008")).toBeVisible();

  // Affichage en clair, audité
  await page.getByRole("button", { name: "Afficher en clair" }).click();
  await expect(page.getByText("CM2110002000300277976315008")).toBeVisible();
  await expect(page.getByText("198765432", { exact: true })).toBeVisible();

  // Liste et recherche
  await page.getByRole("link", { name: "← Salariés" }).click();
  await expect(page.getByRole("link", { name: "Fictif Jean" })).toBeVisible();
  await expect(page.getByText("185 000")).toBeVisible();

  // Sortie
  await page.getByRole("link", { name: "Fictif Jean" }).click();
  await page
    .locator("form", { hasText: "Sortie du salarié" })
    .getByLabel("Date de fin")
    .fill("2026-09-30");
  await page.getByRole("button", { name: "Enregistrer la sortie" }).click();
  await expect(page.getByText("Aucun salarié pour l'instant.")).toBeVisible();
  await page.getByLabel("Afficher les salariés sortis").check();
  await page.getByPlaceholder("Rechercher").press("Enter");
  await expect(page.getByText("Sorti", { exact: true })).toBeVisible();
});
