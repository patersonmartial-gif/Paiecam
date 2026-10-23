import "server-only";
import { parseKeyring } from "@paiecam/security";
import { env } from "@/env";

/** Trousseau unique du serveur. Les clés ne quittent jamais ce module. */
export const keyring = parseKeyring(env.FIELD_ENCRYPTION_KEYS);
