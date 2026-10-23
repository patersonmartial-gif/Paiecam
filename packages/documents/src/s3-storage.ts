import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { blobKeyId, decryptBlob, encryptBlob, type Keyring } from "@paiecam/security";
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
 * chiffré au repos par le fournisseur. Écriture unique (If-None-Match) : un document n'est jamais écrasé,
 * sauf rechiffrement lors d'une rotation de clés, conditionné à l'ETag lu (If-Match).
 */
export function createS3Storage(
  config: S3Config,
  keyring: Keyring,
  client?: S3Sender,
): DocumentStorage {
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
  const read = async (key: string) => {
    const res = (await s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }))) as {
      Body?: { transformToByteArray(): Promise<Uint8Array> };
      ETag?: string;
    };
    if (!res.Body || !res.ETag) throw new Error("document introuvable dans le stockage");
    return { body: await res.Body.transformToByteArray(), etag: res.ETag };
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
      return decryptBlob(keyring, key, (await read(key)).body);
    },
    async reencrypt(key) {
      check(key);
      const { body, etag } = await read(key);
      if (blobKeyId(body) === keyring.currentId) return "current";
      await s3.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: encryptBlob(keyring, key, decryptBlob(keyring, key, body)),
          ContentType: "application/octet-stream",
          // Échoue si le fichier a changé entre la lecture et l'écriture.
          IfMatch: etag,
          ServerSideEncryption: "AES256",
        }),
      );
      return "rewritten";
    },
  };
}
