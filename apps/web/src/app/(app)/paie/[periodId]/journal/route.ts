import { getRequestContext } from "@/server/authz";
import { keyring } from "@/server/crypto";
import { db } from "@/server/db";
import { makeExportJournal } from "@/server/features/declarations";

const exportJournal = makeExportJournal(db, keyring);

export async function GET(_req: Request, { params }: { params: Promise<{ periodId: string }> }) {
  const { periodId } = await params;
  const res = await exportJournal(await getRequestContext(), { periodId });
  if (!res.ok)
    return new Response(null, { status: res.error.code === "UNAUTHENTICATED" ? 401 : 404 });
  return new Response(new Uint8Array(res.data.file), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${res.data.filename}"`,
      "cache-control": "no-store",
    },
  });
}
