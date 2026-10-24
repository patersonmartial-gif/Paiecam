/**
 * Dépannage des comptes sur une installation locale, sans e-mail : exécuté par l'administrateur
 * du PC (outil paiecam-admin), jamais depuis l'application web. Chaque opération est tracée.
 */
import { randomInt } from "node:crypto";
import { and, eq, schema, type Db } from "@paiecam/db";
import { auditAuthEvent } from "../auth/audit";
import { hashPassword } from "../auth/password";
import { lockKey, resetFailures } from "../auth/lockout";

/** Mot de passe provisoire lisible : 5 groupes de 4 caractères sans ambiguïté (~100 bits). */
export function temporaryPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const group = () =>
    Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join("");
  return Array.from({ length: 5 }, group).join("-");
}

async function findUser(db: Db, email: string) {
  const [u] = await db
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.email, email.trim().toLowerCase()));
  if (!u) throw new Error("aucun compte avec cette adresse");
  return u;
}

/** Nouveau mot de passe provisoire ; sessions fermées, verrouillages levés. */
export async function resetPassword(db: Db, email: string): Promise<string> {
  const u = await findUser(db, email);
  const password = temporaryPassword();
  const updated = await db
    .update(schema.accounts)
    .set({ password: await hashPassword(password), updatedAt: new Date() })
    .where(and(eq(schema.accounts.userId, u.id), eq(schema.accounts.providerId, "credential")))
    .returning({ id: schema.accounts.id });
  if (updated.length === 0) throw new Error("ce compte n'a pas de mot de passe");
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, u.id));
  await resetFailures(db, lockKey("signin", u.email));
  await resetFailures(db, lockKey("reauth", u.id));
  await auditAuthEvent(db, { action: "admin.password_reset", userId: u.id });
  return password;
}

/** Téléphone perdu : la double authentification est retirée, à réactiver à la connexion. */
export async function resetTwoFactor(db: Db, email: string): Promise<void> {
  const u = await findUser(db, email);
  await db.delete(schema.twoFactors).where(eq(schema.twoFactors.userId, u.id));
  await db.update(schema.users).set({ twoFactorEnabled: false }).where(eq(schema.users.id, u.id));
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, u.id));
  await auditAuthEvent(db, { action: "admin.two_factor_reset", userId: u.id });
}
