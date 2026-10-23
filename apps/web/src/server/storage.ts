import "server-only";
import { env } from "@/env";
import { storageFromEnv } from "@/storage-from-env";
import { keyring } from "./crypto";

export const storage = storageFromEnv(env, keyring);
