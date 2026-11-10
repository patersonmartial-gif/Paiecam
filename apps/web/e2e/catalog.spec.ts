import { expect, test } from "./fixtures";
import { ownerWithCompany, uniqueEmail } from "./helpers";

test("catalogue : le propriétaire ajoute un médicament et une consultation, puis change un prix", async ({
  page,
}) => {
  await ownerWithCompany(
    page,
    uniqueEmail("proprio-catalogue"),
    "Clinique Fictive",
    "M000000000080C",
  );
  await page.getByRole("link", { name: "Catalogue" }).click();
  await expect(page.getByText("Le catalogue est vide.")).toBeVisible();

  await page.getByLabel("Nature").selectOption("medicine");
  await page.getByLabel("Code").fill("para-500");
  await page.getByLabel("Désignation").fill("Paracétamol 500 mg");
  await page.getByLabel("Prix TTC (FCFA)").fill("1500");
  await page.getByLabel("Forme").fill("Comprimé");
  await page.getByLabel("Unité de vente").fill("Boîte de 20");
  await page.getByLabel("Seuil d'alerte de stock").fill("10");
  await page.getByLabel("TVA").selectOption("standard");
  await page.getByRole("button", { name: "Ajouter au catalogue" }).click();
  await expect(page.getByText("Article ajouté.")).toBeVisible();

  await page.getByLabel("Nature").selectOption("service");
  await page.getByLabel("Code").fill("CONS-GEN");
  await page.getByLabel("Désignation").fill("Consultation générale");
  await page.getByLabel("Prix TTC (FCFA)").fill("5000");
  await page.getByRole("button", { name: "Ajouter au catalogue" }).click();
  await expect(page.getByRole("cell", { name: "CONS-GEN" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "PARA-500" })).toBeVisible();

  await page.getByLabel("Prix TTC de Paracétamol 500 mg").fill("1750");
  await page
    .getByRole("row", { name: /PARA-500/ })
    .getByRole("button", { name: "Modifier" })
    .click();
  await expect(page.getByText("Prix mis à jour.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Prix TTC de Paracétamol 500 mg")).toHaveValue("1750");
});
