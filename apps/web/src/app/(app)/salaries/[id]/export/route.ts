import { getRequestContext } from "@/server/authz";
import { keyring } from "@/server/crypto";
import { db } from "@/server/db";
import { makeExportEmployeeData } from "@/server/features/data-rights";

const exportData = makeExportEmployeeData(db, keyring);

/** Droit d'accès d'un salarié : /salaries/<id>/export?format=json|pdf */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const format = new URL(req.url).searchParams.get("format") === "pdf" ? "pdf" : "json";
  const res = await exportData(await getRequestContext(), { employeeId: id, format });
  if (!res.ok)
    return new Response(null, { status: res.error.code === "UNAUTHENTICATED" ? 401 : 404 });
  return new Response(new Uint8Array(res.data.file), {
    headers: {
      "content-type": res.data.contentType,
      "content-disposition": `attachment; filename="${res.data.filename}"`,
      "cache-control": "no-store, private",
    },
  });
}
