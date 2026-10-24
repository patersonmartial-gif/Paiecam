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
  /** Faux quand aucun e-mail ne peut partir (installation locale sans fournisseur). */
  readonly enabled: boolean;
  send(mail: Mail): Promise<void>;
}

/** Transport SMTP minimal (nodemailer en production, faux transport dans les tests). */
export interface SmtpTransport {
  sendMail(message: { from: string; to: string; subject: string; text: string }): Promise<unknown>;
}

export interface MailerOptions {
  /** Installation locale : sans SMTP, pas d'erreur mais pas d'envoi (les écrans s'adaptent). */
  local?: boolean | undefined;
  outboxDir?: string | undefined;
  smtp?: { transport: SmtpTransport; from: string } | undefined;
}

/**
 * - SMTP configuré (production) : envoi réel, en-têtes nettoyés ;
 * - sinon en production : échec explicite, jamais d'envoi silencieusement perdu ;
 * - en développement : affichage console et boîte d'envoi locale (comptes fictifs uniquement).
 */
export function createMailer(
  nodeEnv: string,
  options: MailerOptions | string | undefined = {},
): Mailer {
  const opts: MailerOptions =
    typeof options === "string" ? { outboxDir: options } : (options ?? {});
  if (opts.smtp) {
    const { transport, from } = opts.smtp;
    return {
      enabled: true,
      async send(raw) {
        const mail = sanitizeMail(raw);
        await transport.sendMail({ from, to: mail.to, subject: mail.subject, text: mail.text });
      },
    };
  }
  if (nodeEnv === "production" && opts.local) {
    return {
      enabled: false,
      async send() {
        throw new Error("Envoi d'e-mail désactivé sur cette installation");
      },
    };
  }
  if (nodeEnv === "production") {
    return {
      enabled: true,
      async send() {
        throw new Error("Aucun fournisseur d'e-mail configuré");
      },
    };
  }
  return {
    enabled: true,
    async send(raw) {
      const mail = sanitizeMail(raw);
      console.warn(`[mail:dev] à ${mail.to} — ${mail.subject}\n${mail.text}`);
      // Boîte d'envoi locale (dev et tests de bout en bout) : un fichier JSON par e-mail.
      if (opts.outboxDir) {
        const { mkdir, writeFile } = await import("node:fs/promises");
        await mkdir(opts.outboxDir, { recursive: true });
        await writeFile(
          `${opts.outboxDir}/${Date.now()}-${crypto.randomUUID()}.json`,
          JSON.stringify(mail),
        );
      }
    },
  };
}

/** Transport nodemailer depuis une URL SMTP (ex. smtps://utilisateur:motdepasse@smtp-relay.brevo.com:465). */
export async function smtpTransportFromUrl(url: string): Promise<SmtpTransport> {
  const nodemailer = await import("nodemailer");
  return nodemailer.createTransport(url);
}
