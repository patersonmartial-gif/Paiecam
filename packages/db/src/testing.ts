import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/** Utilitaires réservés aux tests d'intégration : jamais importés par le code applicatif. */

function loadEnv(): void {
  try {
    process.loadEnvFile(new URL("../../../.env", import.meta.url).pathname);
  } catch {
    // en CI, les variables viennent de l'environnement
  }
}

function required(name: string): string {
  loadEnv();
  const value = process.env[name];
  if (!value) throw new Error(`${name} manquant (voir .env.example)`);
  if (!value.includes("_test")) throw new Error(`refus : ${name} doit viser une base « _test »`);
  return value;
}

/** URL du rôle applicatif sur la base de test. */
export const testDatabaseUrl = () => required("TEST_DATABASE_URL");

/** URL du rôle de supervision (événements hors entreprise uniquement) sur la base de test. */
export const testOpsDatabaseUrl = () => required("TEST_OPS_DATABASE_URL");

/** Repart d'une base de test vide et applique toutes les migrations avec le rôle propriétaire. */
export async function resetTestDatabase(): Promise<void> {
  const client = postgres(required("TEST_MIGRATION_DATABASE_URL"), { max: 1, onnotice: () => {} });
  try {
    await client.unsafe(`
      drop schema if exists drizzle cascade;
      drop schema if exists public cascade;
      create schema public;
    `);
    await migrate(drizzle(client), {
      migrationsFolder: new URL("../drizzle", import.meta.url).pathname,
    });
  } finally {
    await client.end();
  }
}
