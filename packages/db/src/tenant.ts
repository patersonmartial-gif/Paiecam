import { sql } from "drizzle-orm";
import type { Db } from "./client";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Exécute `fn` dans une transaction où le RLS limite toutes les lignes au tenant donné.
 * Le contexte est local à la transaction : il ne fuit jamais vers une autre requête du pool.
 */
export async function withTenant<T>(
  db: Db,
  ctx: { tenantId: string; userId: string },
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!UUID.test(ctx.tenantId)) throw new Error("tenantId invalide");
  if (!ctx.userId) throw new Error("userId requis");
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.tenant_id', ${ctx.tenantId}, true), set_config('app.user_id', ${ctx.userId}, true)`,
    );
    return fn(tx);
  });
}

/**
 * Contexte utilisateur sans tenant : ne donne accès qu'aux appartenances de cet utilisateur
 * (pour choisir une entreprise à la connexion) et à la création d'une entreprise.
 */
export async function withUser<T>(db: Db, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!userId) throw new Error("userId requis");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}
