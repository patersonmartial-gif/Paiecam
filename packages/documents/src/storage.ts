import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { blobKeyId, decryptBlob, encryptBlob, type Keyring } from "@paiecam/security";

/** Stockage des documents, toujours chiffré côté application (en plus du chiffrement du fournisseur). */
export interface DocumentStorage {
  put(key: string, data: Uint8Array): Promise<void>;
  get(key: string): Promise<Buffer>;
  /**
   * Rotation des clés : rechiffre le fichier avec la clé courante s'il a été chiffré avec une
   * ancienne clé. Remplacement atomique, contenu en clair inchangé. Seule exception à l'écriture unique.
   */
  reencrypt(key: string): Promise<"rewritten" | "current">;
}

const SAFE_KEY = /^[a-z0-9][a-z0-9/_.-]{0,200}$/;

function assertKey(key: string) {
  if (!SAFE_KEY.test(key) || key.includes("..") || normalize(key) !== key)
    throw new Error("clé de stockage invalide");
}

/** Stockage sur disque (développement, tests). En production : un adaptateur S3 avec la même interface. */
export function createFsStorage(root: string, keyring: Keyring): DocumentStorage {
  return {
    async put(key, data) {
      assertKey(key);
      const path = join(root, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, encryptBlob(keyring, key, data), { flag: "wx" });
    },
    async get(key) {
      assertKey(key);
      return decryptBlob(keyring, key, await readFile(join(root, key)));
    },
    async reencrypt(key) {
      assertKey(key);
      const path = join(root, key);
      const stored = await readFile(path);
      if (blobKeyId(stored) === keyring.currentId) return "current";
      const next = encryptBlob(keyring, key, decryptBlob(keyring, key, stored));
      // Écriture à côté puis renommage : le fichier n'est jamais à moitié écrit.
      const tmp = `${path}.rotation-${randomUUID()}`;
      try {
        await writeFile(tmp, next, { flag: "wx" });
        await rename(tmp, path);
      } finally {
        await rm(tmp, { force: true });
      }
      return "rewritten";
    },
  };
}
