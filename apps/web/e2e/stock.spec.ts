import { expect, test } from "./fixtures";
import { ownerWithCompany, uniqueEmail } from "./helpers";

test("stock : réception d'un lot, casse avec motif, alerte de stock bas", async ({ page }) => {
  await ownerWithCompany(page, uniqueEmail("proprio-stock"), "Pharmacie Fictive", "M000000000090S");
  await page.getByRole("link", { name: "Catalogue" }).click();
  await page.getByLabel("Nature").selectOption("medicine");
  await page.getByLabel("Code").fill("AMOX-500");
  await page.getByLabel("Désignation").fill("Amoxicilline 500 mg");
  await page.getByLabel("Prix TTC (FCFA)").fill("2500");
  await page.getByLabel("Unité de vente").fill("boîtes");
  await page.getByLabel("Seuil d'alerte de stock").fill("10");
  await page.getByRole("button", { name: "Ajouter au catalogue" }).click();
  await expect(page.getByText("Article ajouté.")).toBeVisible();

  await page.getByRole("link", { name: "Stock", exact: true }).click();
  await expect(page.getByText("Rupture")).toBeVisible();
  await page.getByRole("link", { name: "Amoxicilline 500 mg" }).click();
  await page.getByLabel("N° de lot").fill("AMX-2030-01");
  await page.getByLabel("Péremption").fill("2030-06-30");
  await page.getByLabel("Quantité reçue").fill("12");
  await page.getByLabel("Coût d'achat unitaire (FCFA)").fill("1200");
  await page.getByLabel("Fournisseur").fill("Grossiste fictif");
  await page.getByRole("button", { name: "Enregistrer la réception" }).click();
  await expect(page.getByText("Réception enregistrée.")).toBeVisible();
  await expect(page.getByRole("cell", { name: "AMX-2030-01" })).toBeVisible();

  await page.getByLabel("Opération").selectOption("breakage");
  await page.getByLabel(/^Quantité(?! reçue)/).fill("3");
  await page.getByLabel("Motif").fill("Boîtes abîmées à la livraison");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText("Mouvement enregistré.")).toBeVisible();
  await expect(page.getByText("Boîtes abîmées à la livraison")).toBeVisible();

  await page.getByRole("link", { name: /Stock de la pharmacie/ }).click();
  const row = page.getByRole("row", { name: /Amoxicilline/ });
  await expect(row.getByRole("cell").nth(1)).toHaveText(/^9\s*boîtes$/);
  await expect(row).toContainText("Stock bas");
  await expect(row).toContainText("10 800");
});
