import { describe, expect, it } from "vitest";
import { createMailer, sanitizeMail, type SmtpTransport } from "./mail";

describe("sanitizeMail", () => {
  it("supprime les retours à la ligne des en-têtes (injection d'en-têtes)", () => {
    const m = sanitizeMail({
      to: "a@exemple.test",
      subject: "Invitation\r\nBcc: victime@exemple.test",
      text: "corps\nsur deux lignes",
    });
    expect(m.subject).toBe("Invitation Bcc: victime@exemple.test");
    expect(m.text).toBe("corps\nsur deux lignes");
  });
  it("refuse un destinataire invalide ou multiple", () => {
    expect(() =>
      sanitizeMail({ to: "a@exemple.test\r\nb@exemple.test", subject: "x", text: "" }),
    ).toThrow(/destinataire/);
    expect(() => sanitizeMail({ to: "pas-une-adresse", subject: "x", text: "" })).toThrow(
      /destinataire/,
    );
  });
});

describe("createMailer", () => {
  it("envoie par SMTP avec l'expéditeur configuré et des en-têtes nettoyés", async () => {
    const sent: unknown[] = [];
    const transport: SmtpTransport = { sendMail: async (m) => sent.push(m) };
    const mailer = createMailer("production", {
      smtp: { transport, from: "PaieCam <noreply@exemple.test>" },
    });
    await mailer.send({
      to: "a@exemple.test",
      subject: "Objet\r\nBcc: x@exemple.test",
      text: "corps",
    });
    expect(sent).toEqual([
      {
        from: "PaieCam <noreply@exemple.test>",
        to: "a@exemple.test",
        subject: "Objet Bcc: x@exemple.test",
        text: "corps",
      },
    ]);
  });
  it("échoue explicitement en production sans fournisseur", async () => {
    await expect(
      createMailer("production").send({ to: "a@exemple.test", subject: "x", text: "" }),
    ).rejects.toThrow(/fournisseur/);
  });
});

describe("createMailer en installation locale", () => {
  it("sans SMTP : désactivé, sans erreur au démarrage ; avec SMTP : envoie normalement", async () => {
    const off = createMailer("production", { local: true });
    expect(off.enabled).toBe(false);
    await expect(off.send({ to: "a@exemple.test", subject: "x", text: "" })).rejects.toThrow(
      /désactivé/,
    );
    const sent: unknown[] = [];
    const on = createMailer("production", {
      local: true,
      smtp: { transport: { sendMail: async (m) => sent.push(m) }, from: "p@exemple.test" },
    });
    expect(on.enabled).toBe(true);
    await on.send({ to: "a@exemple.test", subject: "x", text: "" });
    expect(sent).toHaveLength(1);
  });
});
