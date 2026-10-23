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

/** Rôle de sauvegarde (lecture seule, exempté du RLS) sur la base de test. */
export const testBackupDatabaseUrl = () => required("TEST_BACKUP_DATABASE_URL");

/** Administrateur PostgreSQL sur la base cible du test de restauration (paiecam_restore_test). */
export const testRestoreAdminDatabaseUrl = () => required("TEST_RESTORE_ADMIN_DATABASE_URL");

/** Recrée, vide, la base cible du test de restauration (connexion d'administration du même serveur). */
export async function recreateRestoreTestDatabase(): Promise<void> {
  const url = new URL(testRestoreAdminDatabaseUrl());
  const name = url.pathname.slice(1);
  if (!/^[a-z_]+_test$/.test(name)) throw new Error("nom de base de restauration inattendu");
  url.pathname = "/postgres";
  const admin = postgres(url.toString(), { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`drop database if exists ${name} with (force)`);
    await admin.unsafe(`create database ${name} owner paiecam_owner`);
  } finally {
    await admin.end();
  }
}

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
  // Le schéma pgboss est conservé (un worker peut déjà tourner, comme dans les parcours Playwright) ;
  // seules ses tâches sont vidées, par le rôle applicatif qui possède ces tables.
  const app = postgres(required("TEST_DATABASE_URL"), { max: 1, onnotice: () => {} });
  try {
    await app.unsafe(`
      do $$ begin
        if to_regclass('pgboss.job') is not null then truncate pgboss.job cascade; end if;
      end $$;
    `);
  } finally {
    await app.end();
  }
}

/** Charge des règles dans la base de test (rôle propriétaire : l'application ne peut pas écrire pay_rules). */
export async function loadTestRules(
  rules: { code: string; validFrom: string; validTo: string | null; value: unknown }[],
  status: "draft" | "validated" = "draft",
): Promise<void> {
  const client = postgres(required("TEST_MIGRATION_DATABASE_URL"), { max: 1, onnotice: () => {} });
  try {
    for (const r of rules) {
      await client`
        insert into pay_rules (id, code, valid_from, valid_to, value, legal_source, status, validated_by, validated_at)
        values (gen_random_uuid(), ${r.code}, ${r.validFrom}, ${r.validTo}, ${client.json(r.value as never)}, 'test',
                ${status}, ${status === "validated" ? "Expert fictif" : null}, ${status === "validated" ? new Date() : null})
        on conflict (code, valid_from) do nothing`;
    }
  } finally {
    await client.end();
  }
}

/** Passe toutes les règles brouillon en « validées » (base de test uniquement). */
export async function validateAllTestRules(): Promise<void> {
  const client = postgres(required("TEST_MIGRATION_DATABASE_URL"), { max: 1, onnotice: () => {} });
  try {
    await client`update pay_rules set status = 'validated', validated_by = 'Expert fictif', validated_at = now() where status = 'draft'`;
  } finally {
    await client.end();
  }
}
