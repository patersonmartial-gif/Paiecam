import { and, eq, schema, type Db } from "@paiecam/db";
import { verifyPassword } from "./password";

/** Revérifie le mot de passe de l'utilisateur avant une opération sensible (ex. changer un IBAN). */
export async function verifyUserPassword(
  db: Db,
  userId: string,
  password: string,
): Promise<boolean> {
  if (!password) return false;
  const [account] = await db
    .select({ hash: schema.accounts.password })
    .from(schema.accounts)
    .where(and(eq(schema.accounts.userId, userId), eq(schema.accounts.providerId, "credential")));
  if (!account?.hash) return false;
  return verifyPassword({ hash: account.hash, password });
}
