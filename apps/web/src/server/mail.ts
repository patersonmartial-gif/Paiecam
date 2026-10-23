export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Neutralise les retours à la ligne dans les champs d'en-tête (injection d'en-têtes SMTP) :
 * le sujet contient des données saisies par les utilisateurs (raison sociale…).
 */
export function sanitizeMail(mail: Mail): Mail {
  const header = (v: string) => v.replace(/[\r\n\t]+/g, " ").trim();
  const to = header(mail.to);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error("destinataire invalide");
  return { to, subject: header(mail.subject).slice(0, 200), text: mail.text };
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/**
 * En développement, les e-mails sont affichés dans la console (comptes fictifs uniquement).
 * En production, l'envoi échoue tant qu'aucun fournisseur n'est branché : jamais d'envoi silencieux perdu.
 */
export function createMailer(nodeEnv: string, outboxDir?: string): Mailer {
  if (nodeEnv === "production") {
    return {
      async send() {
        throw new Error("Aucun fournisseur d'e-mail configuré");
      },
    };
  }
  return {
    async send(raw) {
      const mail = sanitizeMail(raw);
      console.warn(`[mail:dev] à ${mail.to} — ${mail.subject}\n${mail.text}`);
      // Boîte d'envoi locale (dev et tests de bout en bout) : un fichier JSON par e-mail.
      if (outboxDir) {
        const { mkdir, writeFile } = await import("node:fs/promises");
        await mkdir(outboxDir, { recursive: true });
        await writeFile(
          `${outboxDir}/${Date.now()}-${crypto.randomUUID()}.json`,
          JSON.stringify(mail),
        );
      }
    },
  };
}
