import { resetTestDatabase } from "@paiecam/db/testing";

// Base de test remise à zéro et migrée avant chaque fichier : aucun ordre d'exécution supposé.
await resetTestDatabase();
