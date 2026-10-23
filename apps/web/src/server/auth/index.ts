import "server-only";
import { env } from "@/env";
import { db } from "../db";
import { mailer } from "../mailer";
import { createAuth } from "./config";

export const auth = createAuth({
  db,
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.APP_URL,
  mailer,
  checkPwnedPasswords: env.PWNED_PASSWORDS_CHECK === "on",
});
