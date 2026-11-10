import { buildSalesReport } from "@paiecam/documents";
import { getRequestContext } from "@/server/authz";
import { db } from "@/server/db";
import { makeSalesReport } from "@/server/features/reports";

const report = makeSalesReport(db);

/** Rapport des ventes au format Excel (droits vérifiés ; cellules neutralisées contre les formules). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const ctx = await getRequestContext();
  const res = await report(ctx, {
    from: url.searchParams.get("du"),
    to: url.searchParams.get("au"),
  });
  if (!res.ok) {
    const status =
      res.error.code === "UNAUTHENTICATED" ? 401 : res.error.code === "FORBIDDEN" ? 403 : 400;
    return new Response(null, { status });
  }
  const file = await buildSalesReport(res.data);
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="ventes-${res.data.from}-${res.data.to}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
