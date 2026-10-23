import { db } from "@/server/db";
import { keyring } from "@/server/crypto";
import { readSignedDownload } from "@/server/features/documents";
import { storage } from "@/server/storage";

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("jeton") ?? "";
  const file = await readSignedDownload(db, { keyring, storage }, token);
  if (!file) return new Response("Lien expiré ou invalide.", { status: 403 });
  return new Response(new Uint8Array(file.pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${file.filename}"`,
      "cache-control": "no-store, private",
      "referrer-policy": "no-referrer",
    },
  });
}
