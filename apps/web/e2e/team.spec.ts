import { expect, test } from "./fixtures";
import { ownerWithCompany, signUp, uniqueEmail } from "./helpers";
import { lastMailTo } from "./outbox";

test("le propriétaire invite un comptable, qui rejoint l'entreprise en lecture seule", async ({
  page,
  browser,
}) => {
  await ownerWithCompany(page, uniqueEmail("proprio"), "Quincaillerie Fictive", "M000000000010Q");

  // Invitation
  const accountant = uniqueEmail("comptable");
  await page.getByRole("link", { name: "Équipe" }).click();
  await page.getByLabel("Adresse e-mail").fill(accountant);
  await page.getByRole("button", { name: "Envoyer l'invitation" }).click();
  await expect(page.getByText("Invitation envoyée.")).toBeVisible();
  await expect(page.getByText(accountant)).toBeVisible();

  const mail = await lastMailTo(accountant);
  const link = /http:\/\/\S+\/invitation\/[\w-]+/.exec(mail.text)?.[0] ?? "";
  expect(link).not.toBe("");

  // L'invité ouvre le lien dans un autre navigateur, crée son compte et accepte
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(link);
  await guest.getByRole("link", { name: "Créer un compte" }).click();
  await signUp(guest, accountant, "Comptable Fictif");
  await expect(
    guest.getByText("Rejoindre Quincaillerie Fictive en tant que Comptable"),
  ).toBeVisible();
  await guest.getByRole("button", { name: "Accepter l'invitation" }).click();
  await expect(guest.getByText("Votre rôle : Comptable")).toBeVisible();

  // Lecture seule sur la fiche entreprise
  await guest.getByRole("link", { name: "Entreprise", exact: true }).click();
  await expect(
    guest.getByText("Seul le propriétaire peut modifier ces informations."),
  ).toBeVisible();
  await expect(guest.getByRole("button", { name: "Enregistrer" })).toHaveCount(0);

  // Le lien ne sert qu'une fois
  await guest.goto(link);
  await expect(guest.getByText("Cette invitation a déjà été utilisée.")).toBeVisible();

  // Côté propriétaire, le comptable apparaît dans l'équipe
  await page.reload();
  await expect(page.getByText("Comptable Fictif")).toBeVisible();
});
