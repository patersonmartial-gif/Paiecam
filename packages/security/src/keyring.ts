import { hkdfSync } from "node:crypto";

/**
 * Trousseau de clés maîtresses, du plus récent au plus ancien.
 * Format de la variable d'environnement : « v2:<base64>,v1:<base64> » (32 octets chacune).
 * La première clé chiffre ; toutes déchiffrent. En production, la valeur vient du KMS.
 */
export interface Keyring {
  currentId: string;
  /** Sous-clés dérivées par usage : on n'utilise jamais la même clé pour deux usages. */
  encryptionKey(id: string): Buffer;
  blindIndexKey(id: string): Buffer;
  documentSigningKey(id: string): Buffer;
}

const KEY_ID = /^v\d+$/;

function derive(master: Buffer, usage: string, id: string): Buffer {
  return Buffer.from(hkdfSync("sha256", master, "paiecam", `${usage}:${id}`, 32));
}

export function parseKeyring(value: string): Keyring {
  const entries = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [id, b64, ...rest] = entry.split(":");
      if (!id || !KEY_ID.test(id) || !b64 || rest.length > 0) {
        throw new Error("trousseau invalide : format attendu « v1:<base64> »");
      }
      const key = Buffer.from(b64, "base64");
      if (key.length !== 32) throw new Error(`la clé ${id} doit faire 32 octets`);
      return [id, key] as const;
    });
  const first = entries[0];
  if (!first) throw new Error("trousseau vide");
  const masters = new Map(entries);
  if (masters.size !== entries.length) throw new Error("identifiant de clé en double");

  const cache = new Map<string, Buffer>();
  const get = (usage: string, id: string) => {
    const cacheKey = `${usage}:${id}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    const master = masters.get(id);
    if (!master) throw new Error(`clé ${id} absente du trousseau`);
    const derived = derive(master, usage, id);
    cache.set(cacheKey, derived);
    return derived;
  };

  return {
    currentId: first[0],
    encryptionKey: (id) => get("field-encryption", id),
    blindIndexKey: (id) => get("blind-index", id),
    documentSigningKey: (id) => get("document-signature", id),
  };
}
