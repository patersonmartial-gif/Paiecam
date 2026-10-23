import { describe, expect, it } from "vitest";
import { sanitizeMail } from "./mail";

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
