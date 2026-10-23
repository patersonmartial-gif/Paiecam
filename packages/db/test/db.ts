import { createDb } from "../src";

try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url).pathname);
} catch {
  // en CI, les variables viennent de l'environnement
}

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL manquant (voir .env.example)");

/** Connexion avec le rôle applicatif, exactement comme en production. */
export const db = createDb(url);
