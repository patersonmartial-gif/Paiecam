import { readSheet } from "read-excel-file/node";
import writeXlsxFile from "write-excel-file/node";
import { expect, test } from "./fixtures";
import { ownerWithCompany, uniqueEmail } from "./helpers";

async function xlsx(rows: string[][]): Promise<Buffer> {
  return writeXlsxFile(rows.map((r) => r.map((value) => ({ value, type: String })))).toBuffer();
}

test("importer des salariés depuis le modèle Excel, avec correction d'une erreur", async ({
  page,
}) => {
  await ownerWithCompany(page, uniqueEmail("proprio-imp"), "Garage Fictif", "M000000000030G");
  await page.getByRole("link", { name: "Salariés", exact: true }).click();
  await page.getByRole("link", { name: "Importer depuis Excel" }).click();

  // Le modèle se télécharge et contient les bons en-têtes
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Téléchargez le modèle Excel" }).click();
  const template = await readSheet(await (await download).path());
  const header = template[0]?.map(String) ?? [];
  expect(header[0]).toBe("Matricule");

  const line = (m: string, name: string, salary: string) => [
    m,
    name,
    "Test",
    "01/05/1990",
    "",
    "15/01/2024",
    "CDI",
    "",
    "Mécanicien",
    "4",
    "B",
    salary,
    "Célibataire",
    "0",
    "Espèces",
  ];

  // Un fichier avec une erreur (salaire non numérique) : rien n'est importé
  await page.getByLabel("Fichier .xlsx").setInputFiles({
    name: "salaries.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: await xlsx([header, line("G-1", "UN", "150000"), line("G-2", "DEUX", "beaucoup")]),
  });
  await page.getByRole("button", { name: "Vérifier le fichier" }).click();
  await expect(page.getByText("2 ligne(s) lue(s) : 1 prête(s), 1 en erreur.")).toBeVisible();
  await expect(page.getByText("Champs à corriger : Salaire de base (FCFA/mois)")).toBeVisible();
  await expect(page.getByRole("button", { name: /Importer/ })).toHaveCount(0);

  // Un faux .xlsx est refusé
  await page
    .getByLabel("Fichier .xlsx")
    .setInputFiles({ name: "faux.xlsx", mimeType: "text/csv", buffer: Buffer.from("a;b\n1;2") });
  await page.getByRole("button", { name: "Vérifier le fichier" }).click();
  await expect(
    page.getByText("Ce fichier n'est pas un classeur Excel .xlsx valide."),
  ).toBeVisible();

  // Fichier corrigé : aperçu puis import
  await page.getByLabel("Fichier .xlsx").setInputFiles({
    name: "salaries.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: await xlsx([
      header,
      line("G-1", "UN", "150000"),
      line("G-2", "DEUX", "175000"),
      line("G-3", "TROIS", "90000"),
    ]),
  });
  await page.getByRole("button", { name: "Vérifier le fichier" }).click();
  await page.getByRole("button", { name: "Importer 3 salarié(s)" }).click();
  await expect(page.getByText("3 salarié(s) importé(s).")).toBeVisible();
  await page.getByRole("link", { name: "Voir la liste" }).click();
  await expect(page.getByRole("link", { name: "DEUX Test" })).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(4);
});
