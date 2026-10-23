import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/** Repart d'une base de test vide et applique toutes les migrations avec le rôle propriétaire. */
export default async function setup() {
  try {
    process.loadEnvFile(new URL("../../../.env", import.meta.url).pathname);
  } catch {
    // en CI, les variables viennent de l'environnement
  }
  const url = process.env.TEST_MIGRATION_DATABASE_URL;
  if (!url) throw new Error("TEST_MIGRATION_DATABASE_URL manquant (voir .env.example)");
  if (!url.includes("_test")) throw new Error("refus : la base de test doit contenir « _test »");

  const client = postgres(url, { max: 1, onnotice: () => {} });
  await client.unsafe(`
    drop schema if exists drizzle cascade;
    drop schema if exists public cascade;
    create schema public;
  `);
  await migrate(drizzle(client), {
    migrationsFolder: new URL("../drizzle", import.meta.url).pathname,
  });
  await client.end();
}
