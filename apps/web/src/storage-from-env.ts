import { createFsStorage, createS3Storage, type DocumentStorage } from "@paiecam/documents";
import type { Keyring } from "@paiecam/security";
import type { Env } from "./env-schema";

/** Stockage des documents selon la configuration (application, worker, rotation des clés). */
export function storageFromEnv(env: Env, keyring: Keyring): DocumentStorage {
  return env.STORAGE_DRIVER === "s3"
    ? createS3Storage(
        {
          endpoint: env.S3_ENDPOINT ?? "",
          region: env.S3_REGION ?? "",
          bucket: env.S3_BUCKET ?? "",
          accessKeyId: env.S3_ACCESS_KEY_ID ?? "",
          secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? "",
        },
        keyring,
      )
    : createFsStorage(env.DOCUMENTS_DIR, keyring);
}
