import { and, eq, schema, type Db } from "@paiecam/db";
import { RuleError } from "../authz/action";
import { lockedUntil, lockKey, recordFailure, resetFailures } from "./lockout";
import { verifyPassword } from "./password";

/**
 * Revérifie le mot de passe avant une opération sensible (IBAN, validation de paie).
 * Verrouillage progressif par utilisateur : au-delà de 5 échecs, RuleError « too_many_attempts ».
 */
export async function verifyUserPassword(
  db: Db,
  userId: string,
  password: string,
): Promise<boolean> {
  const key = lockKey("reauth", userId);
  if (await lockedUntil(db, key)) throw new RuleError("too_many_attempts");
  const [account] = await db
    .select({ hash: schema.accounts.password })
    .from(schema.accounts)
    .where(and(eq(schema.accounts.userId, userId), eq(schema.accounts.providerId, "credential")));
  const valid =
    !!password && !!account?.hash && (await verifyPassword({ hash: account.hash, password }));
  if (valid) await resetFailures(db, key);
  else await recordFailure(db, key);
  return valid;
}
