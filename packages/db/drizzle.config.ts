import { defineConfig } from "drizzle-kit";

// .env à la racine du monorepo, s'il existe (en CI, les variables viennent de l'environnement).
try {
  process.loadEnvFile("../../.env");
} catch {
  // pas de fichier .env
}

// Les migrations tournent avec le rôle propriétaire, jamais avec le rôle applicatif.
const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error("MIGRATION_DATABASE_URL manquant (voir .env.example)");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
  strict: true,
});
