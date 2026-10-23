import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { haveIBeenPwned, twoFactor } from "better-auth/plugins";
import { uuidv7 } from "uuidv7";
import { schema, type Db } from "@paiecam/db";
import type { Mailer } from "../mail";
import { hashPassword, verifyPassword } from "./password";

export interface AuthDeps {
  db: Db;
  secret: string;
  baseURL: string;
  mailer: Mailer;
  /** Désactivable dans les tests et hors ligne en dev ; jamais en production (voir env.ts). */
  checkPwnedPasswords?: boolean;
}

const EIGHT_HOURS = 8 * 60 * 60;

export function createAuth({ db, secret, baseURL, mailer, checkPwnedPasswords = true }: AuthDeps) {
  return betterAuth({
    appName: "PaieCam",
    secret,
    baseURL,
    trustedOrigins: [baseURL],
    database: drizzleAdapter(db, { provider: "pg", schema: schema.authSchema }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      password: { hash: hashPassword, verify: verifyPassword },
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 30 * 60,
      async sendResetPassword({ user, url }) {
        await mailer.send({
          to: user.email,
          subject: "Réinitialisation de votre mot de passe PaieCam",
          text: `Pour choisir un nouveau mot de passe, ouvrez ce lien (valable 30 minutes) :\n${url}`,
        });
      },
    },
    session: {
      // Durée absolue de 8 h : pas de prolongation glissante.
      expiresIn: EIGHT_HOURS,
      disableSessionRefresh: true,
      // Les opérations sensibles (valider une paie, changer un IBAN) exigent une session de moins de 15 min.
      freshAge: 15 * 60,
    },
    // À régler au déploiement (phase 6) : advanced.ipAddress.ipAddressHeaders doit viser l'en-tête
    // posé par le proxy de l'hébergeur, sinon un client peut falsifier x-forwarded-for et
    // contourner les limites ci-dessous.
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 3 },
        "/request-password-reset": { window: 15 * 60, max: 3 },
        "/reset-password": { window: 15 * 60, max: 5 },
        "/two-factor/verify-totp": { window: 60, max: 5 },
        "/two-factor/verify-backup-code": { window: 60, max: 5 },
      },
    },
    advanced: {
      // Explicite : better-auth désactive ces contrôles quand NODE_ENV=test.
      disableOriginCheck: false,
      disableCSRFCheck: false,
      database: { generateId: () => uuidv7() },
      useSecureCookies: baseURL.startsWith("https://"),
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
    },
    plugins: [
      twoFactor({ issuer: "PaieCam" }),
      ...(checkPwnedPasswords
        ? [
            haveIBeenPwned({
              customPasswordCompromisedMessage:
                "Ce mot de passe figure dans une fuite de données connue. Choisissez-en un autre.",
            }),
          ]
        : []),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
