export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/**
 * En développement, les e-mails sont affichés dans la console (comptes fictifs uniquement).
 * En production, l'envoi échoue tant qu'aucun fournisseur n'est branché : jamais d'envoi silencieux perdu.
 */
export function createMailer(nodeEnv: string): Mailer {
  if (nodeEnv === "production") {
    return {
      async send() {
        throw new Error("Aucun fournisseur d'e-mail configuré");
      },
    };
  }
  return {
    async send(mail) {
      console.warn(`[mail:dev] à ${mail.to} — ${mail.subject}\n${mail.text}`);
    },
  };
}
