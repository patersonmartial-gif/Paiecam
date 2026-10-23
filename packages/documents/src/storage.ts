import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { decryptBlob, encryptBlob, type Keyring } from "@paiecam/security";

/** Stockage des documents, toujours chiffré côté application (en plus du chiffrement du fournisseur). */
export interface DocumentStorage {
  put(key: string, data: Uint8Array): Promise<void>;
  get(key: string): Promise<Buffer>;
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
  };
}
