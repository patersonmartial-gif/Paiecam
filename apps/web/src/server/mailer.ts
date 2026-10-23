import "server-only";
import { env } from "@/env";
import { createMailer } from "./mail";

export const mailer = createMailer(env.NODE_ENV, env.MAIL_OUTBOX_DIR);
