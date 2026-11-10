import { expect, test } from "./fixtures";
import { ownerWithCompany, PASSWORD, uniqueEmail } from "./helpers";
import type { Locator } from "@playwright/test";

/** Choisit l'option dont le texte contient `text` (les montants ont des espaces insécables). */
async function choose(select: Locator, text: string) {
  const value = await select.locator("option", { hasText: text }).first().getAttribute("value");
  await select.selectOption(value ?? "");
}

test("caisse : vente d'une consultation et d'un médicament, reçu, vérification, annulation par avoir", async ({
  page,
}) => {
  await ownerWithCompany(
    page,
    uniqueEmail("proprio-caisse"),
    "Centre Médical Fictif",
    "M000000000100F",
  );
  await page.getByRole("link", { name: "Catalogue" }).click();
  for (const [kind, code, name, price, tax] of [
    ["service", "CONS-GEN", "Consultation générale", "5000", "exempt"],
    ["medicine", "PARA-500", "Paracétamol 500 mg", "1500", "standard"],
  ] as const) {
    await page.getByLabel("Nature").selectOption(kind);
    await page.getByLabel("Code").fill(code);
    await page.getByLabel("Désignation").fill(name);
    await page.getByLabel("Prix TTC (FCFA)").fill(price);
    await page.getByLabel("TVA").selectOption(tax);
    await page.getByRole("button", { name: "Ajouter au catalogue" }).click();
    await expect(page.getByRole("cell", { name: code })).toBeVisible();
  }
  await page.getByRole("link", { name: "Stock", exact: true }).click();
  await page.getByRole("link", { name: "Paracétamol 500 mg" }).click();
  await page.getByLabel("N° de lot").fill("PAR-01");
  await page.getByLabel("Péremption").fill("2031-01-31");
  await page.getByLabel("Quantité reçue").fill("20");
  await page.getByLabel("Coût d'achat unitaire (FCFA)").fill("700");
  await page.getByRole("button", { name: "Enregistrer la réception" }).click();
  await expect(page.getByText("Réception enregistrée.")).toBeVisible();

  // Vente au comptoir
  await page.getByRole("link", { name: "Caisse", exact: true }).click();
  await choose(
    page.getByRole("combobox", { name: "Article 1", exact: true }),
    "Consultation générale",
  );
  await page.getByRole("button", { name: "+ Ajouter un article" }).click();
  await choose(
    page.getByRole("combobox", { name: "Article 2", exact: true }),
    "Paracétamol 500 mg",
  );
  await page.getByLabel("Quantité de l'article 2").fill("2");
  await expect(page.getByText(/Total à payer : 8\s000 FCFA/)).toBeVisible();
  await page.getByLabel("Mode de paiement").selectOption("orange_money");
  await page.getByLabel("Référence du paiement").fill("OM2611.7788");
  await page.getByLabel("Nom du patient (facultatif)").fill("Patient Fictif");
  await page.getByRole("button", { name: "Encaisser et émettre la facture" }).click();
  await expect(page.getByText("Facture émise.")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Facture F\d{4}-000001/ })).toBeVisible();
  await expect(page.getByText("Patient : Patient Fictif")).toBeVisible();
  await expect(page.getByText("PAR-01 (2)")).toBeVisible();

  // Reçu PDF servi par le serveur, puis vérification publique depuis un autre navigateur
  const receiptHref = await page.getByRole("link", { name: "Reçu PDF" }).getAttribute("href");
  const receipt = await page.request.get(receiptHref ?? "");
  expect(receipt.headers()["content-type"]).toBe("application/pdf");
  expect((await receipt.body()).subarray(0, 5).toString()).toBe("%PDF-");
  const invoiceUrl = page.url();
  const code = (await page.getByRole("link", { name: /^[A-Z2-9]{4}-/ }).textContent()) ?? "";
  // Un visiteur sans session (autre navigateur) vérifie le reçu : rien sur le patient.
  const browser = page.context().browser();
  if (!browser) throw new Error("navigateur indisponible");
  const visitor = await browser.newPage();
  await visitor.goto(new URL(`/recu/${code}`, invoiceUrl).toString());
  await expect(visitor.getByText("Reçu authentique : émis et signé par PaieCam.")).toBeVisible();
  await expect(visitor.getByText("Centre Médical Fictif")).toBeVisible();
  await expect(visitor.getByText("Patient")).toHaveCount(0);
  await visitor.close();
  const [row] = await page.evaluate(() => [document.body.innerText]);
  expect(row).toMatch(/8\s000 FCFA/);

  // Annulation par avoir
  await page.getByLabel("Motif").fill("Erreur de saisie");
  await page.getByLabel("Votre mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Annuler par un avoir" }).click();
  await expect(page.getByRole("heading", { name: /Avoir A\d{4}-000001/ })).toBeVisible();
  await page.goto(invoiceUrl);
  await expect(page.getByText(/Annulée par l'avoir/)).toBeVisible();

  // Stock reconstitué, journal du jour net à zéro
  await page.getByRole("link", { name: "Stock", exact: true }).click();
  await expect(page.getByRole("row", { name: /Paracétamol/ })).toContainText("20");
  await page.getByRole("link", { name: "Factures", exact: true }).click();
  await expect(page.getByRole("row", { name: /F\d{4}-000001/ })).toContainText("Annulée");
  await expect(page.getByText("Total encaissé (net)")).toBeVisible();

  // Clôture de la journée : encaissé net nul après l'avoir, aucune espèce attendue.
  await page.getByRole("link", { name: "Clôture de caisse" }).click();
  await page.getByLabel("Espèces comptées (FCFA)").fill("0");
  await page.getByRole("button", { name: "Clôturer la journée" }).click();
  await expect(page.getByText(/Journée clôturée|La journée est déjà clôturée/)).toBeVisible();

  // Rapport de la période et export Excel
  await page.getByRole("link", { name: "Rapports", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Rapports de ventes" })).toBeVisible();
  await expect(page.getByText("Avoirs", { exact: true })).toBeVisible();
  const exportHref = await page
    .getByRole("link", { name: "Exporter (Excel)" })
    .getAttribute("href");
  const xlsx = await page.request.get(exportHref ?? "");
  expect(xlsx.status()).toBe(200);
  expect(xlsx.headers()["content-type"]).toContain("spreadsheetml");

  // Tableau de bord : tuiles de la caisse, du stock et de la paie
  await page.getByRole("link", { name: "Tableau de bord" }).click();
  await expect(page.getByText("Ventes du jour")).toBeVisible();
  await expect(page.getByText("Médicaments en alerte")).toBeVisible();
  await expect(page.getByText("Dernier mois de paie")).toBeVisible();
  await expect(page.getByText(/prochaines phases/)).toHaveCount(0);
});
