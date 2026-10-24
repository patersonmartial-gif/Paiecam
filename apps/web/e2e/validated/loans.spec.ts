import { expect, test } from "../fixtures";
import { ownerWithCompany, PASSWORD, uniqueEmail } from "../helpers";

test("prêt : créé sur la fiche, retenu sur deux paies validées avec suspension, solde suivi", async ({
  page,
}) => {
  await ownerWithCompany(
    page,
    uniqueEmail("proprio-pret"),
    "Quincaillerie Fictive",
    "M000000000070L",
  );
  await page.goto("/salaries/nouveau");
  await page.getByLabel("Matricule").fill("Q-1");
  await page.getByLabel("Nom", { exact: true }).fill("FICTIF");
  await page.getByLabel("Prénoms").fill("Alain");
  await page.getByLabel("Date de naissance").fill("1989-03-03");
  await page.getByLabel("Date d'embauche").fill("2024-01-15");
  await page.getByLabel("Poste").fill("Vendeur");
  await page.getByLabel("Catégorie").fill("4");
  await page.getByLabel("Échelon").fill("B");
  await page.getByLabel("Salaire de base (FCFA/mois)").fill("400000");
  await page.getByRole("button", { name: "Créer la fiche" }).click();
  await expect(page.getByRole("heading", { name: "FICTIF Alain" })).toBeVisible();
  const employeeUrl = page.url();

  // Prêt de 60 000 FCFA, 25 000 par mois, à partir de septembre 2026.
  await page.getByLabel("Libellé").fill("Prêt moto");
  await page.getByLabel("Montant (FCFA)").fill("60000");
  await page.getByLabel("Retenue mensuelle (FCFA)").fill("25000");
  await page.getByLabel("Date d'octroi").fill("2026-08-25");
  await page.getByLabel("Première retenue (mois)").fill("2026-09");
  await page.getByRole("button", { name: "Enregistrer le prêt" }).click();
  const card = page.getByRole("listitem", { name: "Prêt moto" });
  await expect(card).toContainText("0 FCFA remboursés sur 60 000 FCFA — reste 60 000 FCFA");

  async function payMonth(month: string) {
    await page.getByRole("link", { name: "Paie", exact: true }).click();
    await page.getByLabel("Mois").selectOption(month);
    await page.getByLabel("Année").selectOption("2026");
    await page.getByRole("button", { name: "Ouvrir le mois" }).click();
    await expect(page.getByRole("button", { name: "Calculer les bulletins" })).toBeVisible();
    return page.url();
  }
  async function calculateAndValidate() {
    await page.getByRole("button", { name: "Calculer les bulletins" }).click();
    await expect(page.getByText("Bulletins calculés.")).toBeVisible();
    await page.getByLabel("Votre mot de passe").fill(PASSWORD);
    await page.getByRole("button", { name: "Valider définitivement" }).click();
    await expect(page.getByText(/Paie validée le/)).toBeVisible();
  }

  // Septembre : 1re échéance sur le bulletin.
  await payMonth("9");
  await calculateAndValidate();
  await page.getByRole("link", { name: "Voir" }).click();
  await expect(page.getByText("Prêt moto — échéance 1/3")).toBeVisible();
  await page.goto(employeeUrl);
  await expect(card).toContainText("25 000 FCFA remboursés sur 60 000 FCFA — reste 35 000 FCFA");

  // Octobre : échéance suspendue depuis la fiche, avant le calcul.
  const october = await payMonth("10");
  await page.goto(employeeUrl);
  await card.getByRole("button", { name: "Suspendre l'échéance de 10/2026" }).click();
  await expect(card.getByText("Échéance suspendue pour 10/2026.")).toBeVisible();
  await page.goto(october);
  await calculateAndValidate();
  await page.goto(employeeUrl);
  await expect(card).toContainText("reste 35 000 FCFA");
  await card.getByText("Échéances payées").click();
  await expect(card).toContainText("09/2026 : 25 000 FCFA");
});
