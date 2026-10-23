import { PDFParse } from "pdf-parse";
import { expect, test } from "../fixtures";
import { ownerWithCompany, PASSWORD, uniqueEmail } from "../helpers";

test("paie validée : PDF définitif généré par le worker, téléchargé, puis vérifié", async ({
  page,
}) => {
  await ownerWithCompany(
    page,
    uniqueEmail("proprio-final"),
    "Menuiserie Fictive",
    "M000000000050M",
  );
  await page.goto("/salaries/nouveau");
  await page.getByLabel("Matricule").fill("F-1");
  await page.getByLabel("Nom", { exact: true }).fill("FICTIF");
  await page.getByLabel("Prénoms").fill("Marie");
  await page.getByLabel("Date de naissance").fill("1991-07-07");
  await page.getByLabel("N° CNPS").fill("246813579");
  await page.getByLabel("Date d'embauche").fill("2024-01-15");
  await page.getByLabel("Poste").fill("Menuisière");
  await page.getByLabel("Catégorie").fill("5");
  await page.getByLabel("Échelon").fill("A");
  await page.getByLabel("Salaire de base (FCFA/mois)").fill("400000");
  await page.getByRole("button", { name: "Créer la fiche" }).click();
  await expect(page.getByRole("heading", { name: "FICTIF Marie" })).toBeVisible();

  await page.getByRole("link", { name: "Paie", exact: true }).click();
  await page.getByLabel("Mois").selectOption("5");
  await page.getByLabel("Année").selectOption("2026");
  await page.getByRole("button", { name: "Ouvrir le mois" }).click();
  await page.getByRole("button", { name: "Calculer les bulletins" }).click();
  await expect(page.getByText("Bulletins calculés.")).toBeVisible();
  await expect(page.getByText(/PROVISOIRE/)).toHaveCount(0);

  await page.getByLabel("Votre mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Valider définitivement" }).click();
  await expect(page.getByText(/Paie validée le/)).toBeVisible();

  // Le worker génère le PDF : la page du bulletin finit par proposer le téléchargement.
  await page.getByRole("link", { name: "Voir" }).click();
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole("link", { name: "Télécharger le PDF" })).toBeVisible({
      timeout: 1_000,
    });
  }).toPass({ timeout: 45_000 });

  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Télécharger le PDF" }).click();
  const pdf = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of pdf) chunks.push(c as Buffer);
  const parser = new PDFParse({ data: new Uint8Array(Buffer.concat(chunks)) });
  const text = (await parser.getText()).text.replace(/\s+/g, " ");
  await parser.destroy();
  expect(text).toContain("345 015 FCFA");
  expect(text).toContain("246813579");
  expect(text).not.toContain("PROVISOIRE");

  // Vérification publique depuis le code affiché
  await page.getByRole("link", { name: /Code de vérification/ }).click();
  await expect(page.getByText("Bulletin authentique : émis et signé par PaieCam.")).toBeVisible();
  await expect(page.getByText("Menuiserie Fictive")).toBeVisible();
  // Le champ n'est actif qu'après l'hydratation (sinon le fichier déposé serait ignoré).
  await expect(page.getByLabel(/Comparer avec votre fichier PDF/)).toBeEnabled();
  await page
    .getByLabel(/Comparer avec votre fichier PDF/)
    .setInputFiles({ name: "b.pdf", mimeType: "application/pdf", buffer: Buffer.concat(chunks) });
  await expect(page.getByText("Le fichier est identique à l'original.")).toBeVisible();
  await page.getByLabel(/Comparer avec votre fichier PDF/).setInputFiles({
    name: "faux.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-faux"),
  });
  await expect(
    page.getByText("Le fichier a été modifié : il ne correspond pas à l'original."),
  ).toBeVisible();
});
