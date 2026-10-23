import { describe, expect, it } from "vitest";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { parseKeyring } from "@paiecam/security";
import { createS3Storage, type S3Sender } from "../src";

const ring = parseKeyring(`v1:${Buffer.alloc(32, 3).toString("base64")}`);
const config = { endpoint: "https://s3.exemple.test", region: "fr-par", bucket: "paiecam-docs", accessKeyId: "x", secretAccessKey: "y" };

/** Faux S3 en mémoire qui reproduit l'écriture conditionnelle (If-None-Match). */
function fakeS3() {
  const objects = new Map<string, Uint8Array>();
  const calls: { name: string; input: Record<string, unknown> }[] = [];
  const client: S3Sender = {
    async send(cmd) {
      const input = cmd.input as unknown as Record<string, unknown>;
      calls.push({ name: cmd.constructor.name, input });
      const key = String(input.Key);
      if (cmd instanceof PutObjectCommand) {
        if (input.IfNoneMatch === "*" && objects.has(key)) throw Object.assign(new Error("PreconditionFailed"), { name: "PreconditionFailed" });
        objects.set(key, input.Body as Uint8Array);
        return {};
      }
      if (cmd instanceof GetObjectCommand) {
        const body = objects.get(key);
        return body ? { Body: { transformToByteArray: async () => body } } : {};
      }
      throw new Error("commande inattendue");
    },
  };
  return { client, objects, calls };
}

describe("stockage S3", () => {
  it("envoie un fichier chiffré par l'application, en écriture unique et chiffré au repos", async () => {
    const s3 = fakeS3();
    const storage = createS3Storage(config, ring, s3.client);
    const pdf = Buffer.from("%PDF-1.7 fictif");
    await storage.put("tenant/2026-03/doc.pdf", pdf);
    const put = s3.calls[0]?.input ?? {};
    expect(put).toMatchObject({ Bucket: "paiecam-docs", Key: "tenant/2026-03/doc.pdf", IfNoneMatch: "*", ServerSideEncryption: "AES256" });
    expect(Buffer.from(s3.objects.get("tenant/2026-03/doc.pdf") ?? []).includes(pdf)).toBe(false);
    expect(await storage.get("tenant/2026-03/doc.pdf")).toEqual(pdf);
    await expect(storage.put("tenant/2026-03/doc.pdf", pdf)).rejects.toThrow(/PreconditionFailed/);
  });

  it("refuse les clés dangereuses et signale un document absent", async () => {
    const storage = createS3Storage(config, ring, fakeS3().client);
    await expect(storage.put("../x", Buffer.from("x"))).rejects.toThrow(/clé de stockage invalide/);
    await expect(storage.get("absent.pdf")).rejects.toThrow(/introuvable/);
  });

  it("construit un vrai client S3 si aucun n'est fourni", () => {
    expect(() => createS3Storage(config, ring)).not.toThrow();
  });
});
