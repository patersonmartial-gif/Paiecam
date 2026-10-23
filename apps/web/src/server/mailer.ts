import "server-only";
import { env } from "@/env";
import { createMailer, smtpTransportFromUrl } from "./mail";

export const mailer = createMailer(env.NODE_ENV, {
  outboxDir: env.MAIL_OUTBOX_DIR,
  smtp:
    env.SMTP_URL && env.MAIL_FROM
      ? { transport: await smtpTransportFromUrl(env.SMTP_URL), from: env.MAIL_FROM }
      : undefined,
});
