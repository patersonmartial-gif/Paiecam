import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { decryptBlob, encryptBlob, type Keyring } from "@paiecam/security";
import type { DocumentStorage } from "./storage";

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** Ce que l'adaptateur attend du client S3 (permet de le tester sans réseau). */
export interface S3Sender {
  send(command: PutObjectCommand | GetObjectCommand): Promise<unknown>;
}

const SAFE_KEY = /^[a-z0-9][a-z0-9/_.-]{0,200}$/;

/**
 * Stockage objet compatible S3 (Scaleway, OVHcloud, Clever Cloud Cellar…). Double chiffrement :
 * le fichier est chiffré par l'application (AES-256-GCM, clé du trousseau) avant l'envoi, puis
 * chiffré au repos par le fournisseur. Écriture unique (If-None-Match) : un document n'est jamais écrasé.
 */
export function createS3Storage(config: S3Config, keyring: Keyring, client?: S3Sender): DocumentStorage {
  const s3: S3Sender =
    client ??
    new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  const check = (key: string) => {
    if (!SAFE_KEY.test(key) || key.includes("..")) throw new Error("clé de stockage invalide");
  };
  return {
    async put(key, data) {
      check(key);
      await s3.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: encryptBlob(keyring, key, data),
          ContentType: "application/octet-stream",
          IfNoneMatch: "*",
          ServerSideEncryption: "AES256",
        }),
      );
    },
    async get(key) {
      check(key);
      const res = (await s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }))) as {
        Body?: { transformToByteArray(): Promise<Uint8Array> };
      };
      if (!res.Body) throw new Error("document introuvable dans le stockage");
      return decryptBlob(keyring, key, await res.Body.transformToByteArray());
    },
  };
}
