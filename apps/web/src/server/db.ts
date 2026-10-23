import "server-only";
import { createDb, type Db } from "@paiecam/db";
import { env } from "@/env";

// Une seule instance de pool, y compris lors du rechargement à chaud en développement.
const globalForDb = globalThis as unknown as { paiecamDb?: Db };

export const db: Db = globalForDb.paiecamDb ?? createDb(env.DATABASE_URL);
if (env.NODE_ENV !== "production") globalForDb.paiecamDb = db;
