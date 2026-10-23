import { getRequestContext } from "@/server/authz";
import { keyring } from "@/server/crypto";
import { db } from "@/server/db";
import { makeAuthorizeDownload } from "@/server/features/documents";

const authorize = makeAuthorizeDownload(db, keyring);

/** Vérifie les droits (et audite), puis redirige vers un lien signé valable 5 minutes. */
export async function GET(req: Request, { params }: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await params;
  const res = await authorize(await getRequestContext(), { documentId });
  if (!res.ok)
    return new Response(null, { status: res.error.code === "UNAUTHENTICATED" ? 401 : 404 });
  const url = new URL("/documents/fichier", req.url);
  url.searchParams.set("jeton", res.data.token);
  return Response.redirect(url, 303);
}
