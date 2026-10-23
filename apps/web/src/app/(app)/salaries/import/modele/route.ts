import { getRequestContext } from "@/server/authz";
import { buildEmployeeTemplate } from "@/server/import/employees-sheet";

/** Modèle d'import (aucune donnée) : réservé aux utilisateurs connectés. */
export async function GET() {
  const ctx = await getRequestContext();
  if (!ctx.user) return new Response(null, { status: 401 });
  const body = await buildEmployeeTemplate();
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": 'attachment; filename="paiecam-modele-salaries.xlsx"',
      "cache-control": "no-store",
    },
  });
}
