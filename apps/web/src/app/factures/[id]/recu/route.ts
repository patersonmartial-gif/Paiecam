import { renderReceiptPdf } from "@paiecam/documents";
import { env } from "@/env";
import { getRequestContext } from "@/server/authz";
import { keyring } from "@/server/crypto";
import { db } from "@/server/db";
import { makeGetInvoice } from "@/server/features/billing";

const get = makeGetInvoice(db, keyring);

/** Reçu PDF d'une facture ou d'un avoir (droits vérifiés ; jamais mis en cache). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await get(await getRequestContext(), { id });
  if (!res.ok) {
    const status = res.error.code === "UNAUTHENTICATED" ? 401 : 404;
    return new Response(null, { status });
  }
  const inv = res.data;
  const pdf = await renderReceiptPdf({
    issuer: inv.issuer ?? { legalName: "", niu: "", commune: "" },
    number: inv.number,
    kind: inv.kind,
    credited: inv.credited?.number ?? null,
    issuedAt: inv.issuedAt,
    patientName: inv.patientName,
    paymentMean: inv.paymentMean,
    paymentReference: inv.paymentReference,
    lines: inv.lines,
    taxes: inv.taxes,
    totalHt: inv.totalHt,
    totalTax: inv.totalTax,
    totalTtc: inv.totalTtc,
    draftTax: inv.draftTax,
    verification: {
      code: inv.verificationCode,
      url: new URL(`/recu/${inv.verificationCode}`, env.APP_URL).toString(),
    },
  });
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${inv.number}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
