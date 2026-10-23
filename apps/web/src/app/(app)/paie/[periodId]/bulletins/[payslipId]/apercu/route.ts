import { getRequestContext } from "@/server/authz";
import { keyring } from "@/server/crypto";
import { db } from "@/server/db";
import { makePreviewPayslipPdf } from "@/server/features/documents";

const preview = makePreviewPayslipPdf(db, keyring);

export async function GET(_req: Request, { params }: { params: Promise<{ payslipId: string }> }) {
  const { payslipId } = await params;
  const res = await preview(await getRequestContext(), { payslipId });
  if (!res.ok)
    return new Response(null, { status: res.error.code === "UNAUTHENTICATED" ? 401 : 404 });
  return new Response(new Uint8Array(res.data.pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${res.data.filename}"`,
      "cache-control": "no-store",
    },
  });
}
