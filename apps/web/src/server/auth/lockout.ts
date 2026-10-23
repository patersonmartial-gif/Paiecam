import { createHash } from "node:crypto";
import { eq, schema, sql, type Db } from "@paiecam/db";

/** Durée de blocage (secondes) après `failures` échecs consécutifs. */
export function lockSeconds(failures: number): number {
  if (failures >= 15) return 15 * 60;
  if (failures >= 10) return 5 * 60;
  if (failures >= 5) return 60;
  return 0;
}

/** Clé de verrouillage : empreinte, jamais l'identifiant en clair. */
export const lockKey = (scope: "signin" | "reauth", id: string) =>
  createHash("sha256").update(`${scope}|${id.trim().toLowerCase()}`).digest("hex");

export async function lockedUntil(db: Db, key: string, now = new Date()): Promise<Date | null> {
  const [row] = await db
    .select()
    .from(schema.loginLockouts)
    .where(eq(schema.loginLockouts.key, key));
  return row?.lockedUntil && row.lockedUntil > now ? row.lockedUntil : null;
}

/** Enregistre un échec (atomique) et pose le blocage correspondant. */
export async function recordFailure(db: Db, key: string, now = new Date()): Promise<number> {
  const [row] = await db
    .insert(schema.loginLockouts)
    .values({ key, failures: 1, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.loginLockouts.key,
      set: { failures: sql`${schema.loginLockouts.failures} + 1`, updatedAt: now },
    })
    .returning({ failures: schema.loginLockouts.failures });
  const failures = row?.failures ?? 1;
  const seconds = lockSeconds(failures);
  if (seconds > 0) {
    await db
      .update(schema.loginLockouts)
      .set({ lockedUntil: new Date(now.getTime() + seconds * 1000) })
      .where(eq(schema.loginLockouts.key, key));
  }
  return failures;
}

export async function resetFailures(db: Db, key: string): Promise<void> {
  await db.delete(schema.loginLockouts).where(eq(schema.loginLockouts.key, key));
}
