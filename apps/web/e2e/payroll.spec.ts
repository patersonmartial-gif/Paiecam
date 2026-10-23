import { expect, test } from "./fixtures";
import { ownerWithCompany, uniqueEmail } from "./helpers";

test("mois de paie : saisie, calcul provisoire, bulletin détaillé, réouverture", async ({
  page,
}) => {
  await ownerWithCompany(page, uniqueEmail("proprio-paie"), "Imprimerie Fictive", "M000000000040I");

  // Un salarié à 400 000 FCFA (cas de contrôle 1 du moteur)
  await page.goto("/salaries/nouveau");
  await page.getByLabel("Matricule").fill("I-1");
  await page.getByLabel("Nom", { exact: true }).fill("Fictif");
  await page.getByLabel("Prénoms").fill("Paul");
  await page.getByLabel("Date de naissance").fill("1988-02-01");
  await page.getByLabel("Date d'embauche").fill("2024-01-15");
  await page.getByLabel("Poste").fill("Imprimeur");
  await page.getByLabel("Catégorie").fill("5");
  await page.getByLabel("Échelon").fill("C");
  await page.getByLabel("Salaire de base (FCFA/mois)").fill("400000");
  await page.getByRole("button", { name: "Créer la fiche" }).click();
  await expect(page.getByRole("heading", { name: "Fictif Paul" })).toBeVisible();

  // Ouverture de mars 2026
  await page.getByRole("link", { name: "Paie", exact: true }).click();
  await page.getByLabel("Mois").selectOption("3");
  await page.getByLabel("Année").selectOption("2026");
  await page.getByRole("button", { name: "Ouvrir le mois" }).click();
  await expect(page.getByRole("heading", { name: /mars 2026/i })).toBeVisible();

  // Calcul sans variable : net du cas de contrôle
  await page.getByRole("button", { name: "Calculer les bulletins" }).click();
  await expect(page.getByText("Bulletins calculés.")).toBeVisible();
  await expect(page.getByText(/PROVISOIRE/).first()).toBeVisible();
  // Ligne du salarié et ligne Total (un seul salarié).
  await expect(page.getByRole("cell", { name: "345 015" })).toHaveCount(2);
  await expect(page.getByText("N° CNPS manquant")).toBeVisible();
  // Validation impossible en provisoire
  await page.getByLabel("Votre mot de passe").fill("une phrase de passe assez longue");
  await page.getByRole("button", { name: "Valider définitivement" }).click();
  await expect(page.getByText(/Des bulletins sont provisoires/)).toBeVisible();

  // Détail du bulletin
  await page.getByRole("link", { name: "Voir" }).click();
  await expect(page.getByRole("heading", { name: "Bulletin de paie — Fictif Paul" })).toBeVisible();
  await expect(page.getByText("10 % × IRPP 24 896 FCFA")).toBeVisible();
  await page.goBack();

  // Réouverture, prime de 50 000, recalcul
  await page.getByRole("button", { name: "Rouvrir la saisie" }).click();
  // Le mois repasse « Ouvert » : la grille redevient modifiable.
  await expect(page.getByLabel("Fictif Paul — Prime de rendement")).toBeEnabled();
  await page.getByLabel("Fictif Paul — Prime de rendement").fill("50000");
  await page.getByLabel("Fictif Paul — HS +20 %").fill("2,5");
  await page.getByRole("button", { name: "Enregistrer les variables" }).click();
  await expect(page.getByText("Variables enregistrées.")).toBeVisible();
  await page.getByRole("button", { name: "Calculer les bulletins" }).click();
  await expect(page.getByText("Bulletins calculés.")).toBeVisible();
  await expect(page.getByRole("cell", { name: "345 015" })).toHaveCount(0);
  await expect(page.getByLabel("Fictif Paul — HS +20 %")).toHaveValue("2.5");
});
