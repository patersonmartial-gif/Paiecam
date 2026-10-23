import "server-only";
import { createFsStorage, createS3Storage } from "@paiecam/documents";
import { env } from "@/env";
import { keyring } from "./crypto";

export const storage =
  env.STORAGE_DRIVER === "s3"
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
