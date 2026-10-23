import { createDb } from "../src";
import { testDatabaseUrl } from "../src/testing";

/** Connexion avec le rôle applicatif, exactement comme en production. */
export const db = createDb(testDatabaseUrl());
