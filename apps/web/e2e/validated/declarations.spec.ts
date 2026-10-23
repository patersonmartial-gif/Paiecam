import { readSheet } from "read-excel-file/node";
import { expect, test } from "../fixtures";
import { ownerWithCompany, PASSWORD, uniqueEmail } from "../helpers";

test("déclarations : génération, téléchargement, dépôt, verrouillage, calendrier", async ({
  page,
}) => {
  await ownerWithCompany(page, uniqueEmail("proprio-decl"), "Pressing Fictif", "M000000000060P");
  await page.goto("/salaries/nouveau");
  await page.getByLabel("Matricule").fill("P-1");
  await page.getByLabel("Nom", { exact: true }).fill("FICTIF");
  await page.getByLabel("Prénoms").fill("Léa");
  await page.getByLabel("Date de naissance").fill("1993-03-03");
  await page.getByLabel("N° CNPS").fill("135792468");
  await page.getByLabel("Date d'embauche").fill("2024-01-15");
  await page.getByLabel("Poste").fill("Repasseuse");
  await page.getByLabel("Catégorie").fill("3");
  await page.getByLabel("Échelon").fill("A");
  await page.getByLabel("Salaire de base (FCFA/mois)").fill("400000");
  await page.getByRole("button", { name: "Créer la fiche" }).click();
  await expect(page.getByRole("heading", { name: "FICTIF Léa" })).toBeVisible();

  await page.getByRole("link", { name: "Paie", exact: true }).click();
  await page.getByLabel("Mois").selectOption("6");
  await page.getByLabel("Année").selectOption("2026");
  await page.getByRole("button", { name: "Ouvrir le mois" }).click();
  await page.getByRole("button", { name: "Calculer les bulletins" }).click();
  await expect(page.getByText("Bulletins calculés.")).toBeVisible();
  await page.getByLabel("Votre mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Valider définitivement" }).click();
  await expect(page.getByText(/Paie validée le/)).toBeVisible();

  // Génération : cas de contrôle 1 → CNPS 68 600, DGI 48 185
  await page.getByRole("button", { name: "Générer les déclarations" }).click();
  await expect(page.getByRole("cell", { name: "68 600" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "48 185" })).toBeVisible();
  await expect(page.getByText("15/07/2026").first()).toBeVisible();
  await expect(page.getByText(/DIPE : format provisoire/)).toBeVisible();

  // Téléchargement de l'état CNPS (lien signé) et du journal
  const cnpsDownload = page.waitForEvent("download");
  await page
    .getByRole("row", { name: /Cotisations CNPS/ })
    .getByRole("link", { name: "Télécharger" })
    .click();
  const cnps = await readSheet(await (await cnpsDownload).path());
  expect(cnps.some((r) => r[2] === "135792468")).toBe(true);
  const journalDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: "Journal de paie (Excel)" }).click();
  expect((await journalDownload).suggestedFilename()).toBe("journal-paie-2026-06.xlsx");

  // Dépôt des trois déclarations, puis verrouillage
  for (const kind of ["Cotisations CNPS", "Retenues et taxes DGI", "DIPE"]) {
    await page.getByLabel(`${kind} — Date de dépôt`).fill("2026-07-10");
    await page.getByLabel(`${kind} — Référence de dépôt`).fill(`REF-${kind.slice(0, 4)}`);
    await page
      .getByRole("row", { name: new RegExp(kind) })
      .getByRole("button", { name: "Marquer déposée" })
      .click();
    await expect(
      page.getByRole("row", { name: new RegExp(kind) }).getByText("Déposée"),
    ).toBeVisible();
  }
  await page.getByLabel("Cotisations CNPS — Date de paiement").fill("2026-07-12");
  await page
    .getByRole("row", { name: /Cotisations CNPS/ })
    .getByRole("button", { name: "Marquer payée" })
    .click();
  await expect(page.getByText("payée le 12/07/2026")).toBeVisible();

  await page.getByRole("button", { name: "Verrouiller le mois" }).click();
  await expect(page.getByText("Verrouillé", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Marquer payée" })).toHaveCount(1);

  // Calendrier
  await page.getByRole("link", { name: "Échéances" }).click();
  await expect(page.getByText("Aucune déclaration en attente.")).toBeVisible();
  await expect(page.getByText("Payée")).toBeVisible();
});
