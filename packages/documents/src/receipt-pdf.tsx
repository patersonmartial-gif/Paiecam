/** @jsxRuntime automatic */
/** @jsxImportSource react */
// Transformation JSX imposée dans le fichier : le worker (tsx) n'utilise pas la configuration du package.
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import QRCode from "qrcode";
import { amount } from "./labels";

export interface ReceiptPdfData {
  issuer: { legalName: string; niu: string; commune: string };
  number: string;
  kind: "invoice" | "credit_note";
  /** Avoir : numéro de la facture annulée. */
  credited?: string | null;
  issuedAt: Date;
  patientName?: string | null;
  paymentMean: "cash" | "orange_money" | "mtn_momo";
  paymentReference?: string | null;
  lines: {
    label: string;
    quantity: number;
    unitPriceTtc: number;
    totalTtc: number;
    lots: { lotNumber: string; expiryDate: string }[];
  }[];
  taxes: { category: "standard" | "exempt"; rate: number; baseHt: number; tax: number }[];
  totalHt: number;
  totalTax: number;
  totalTtc: number;
  /** Règle de TVA non validée par l'expert-comptable : mention imprimée. */
  draftTax: boolean;
  verification: { code: string; url: string };
}

const MEANS = { cash: "Espèces", orange_money: "Orange Money", mtn_momo: "MTN Mobile Money" };
const s = StyleSheet.create({
  page: { padding: 24, fontSize: 9, fontFamily: "Helvetica", color: "#1c1917" },
  row: { flexDirection: "row" },
  h1: { fontSize: 13, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  muted: { color: "#57534e" },
  th: {
    fontFamily: "Helvetica-Bold",
    borderBottomWidth: 1,
    borderColor: "#a8a29e",
    paddingBottom: 2,
  },
  cell: { paddingVertical: 2 },
  total: { fontFamily: "Helvetica-Bold", fontSize: 11 },
  warn: { marginTop: 8, padding: 4, borderWidth: 1, borderColor: "#d97706", color: "#92400e" },
});
const pct = (bp: number) => `${(bp / 100).toLocaleString("fr-FR")} %`;
const fcfa = (n: number) => `${amount(n)} FCFA`;

function Receipt({ d, qr }: { d: ReceiptPdfData; qr: string }) {
  const title = d.kind === "credit_note" ? "AVOIR" : "FACTURE — REÇU";
  return (
    <Document title={`${title} ${d.number}`} author={d.issuer.legalName}>
      <Page size="A5" style={s.page}>
        <View style={[s.row, { justifyContent: "space-between" }]}>
          <View>
            <Text style={s.h1}>{d.issuer.legalName}</Text>
            <Text style={s.muted}>
              NIU {d.issuer.niu} · {d.issuer.commune}
            </Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.h1}>{title}</Text>
            <Text>N° {d.number}</Text>
            <Text style={s.muted}>
              {d.issuedAt.toLocaleString("fr-FR", {
                timeZone: "Africa/Douala",
                dateStyle: "short",
                timeStyle: "short",
              })}
            </Text>
          </View>
        </View>
        {d.credited && <Text style={{ marginTop: 6 }}>Annule la facture n° {d.credited}.</Text>}
        {d.patientName && <Text style={{ marginTop: 6 }}>Patient : {d.patientName}</Text>}

        <View style={{ marginTop: 10 }}>
          <View style={s.row}>
            <Text style={[s.th, { flex: 4 }]}>Désignation</Text>
            <Text style={[s.th, { flex: 1, textAlign: "right" }]}>Qté</Text>
            <Text style={[s.th, { flex: 2, textAlign: "right" }]}>P.U. TTC</Text>
            <Text style={[s.th, { flex: 2, textAlign: "right" }]}>Total TTC</Text>
          </View>
          {d.lines.map((l, i) => (
            <View key={i} style={s.row} wrap={false}>
              <View style={[s.cell, { flex: 4 }]}>
                <Text>{l.label}</Text>
                {l.lots.length > 0 && (
                  <Text style={[s.muted, { fontSize: 7 }]}>
                    Lot {l.lots.map((x) => `${x.lotNumber} (pér. ${x.expiryDate})`).join(", ")}
                  </Text>
                )}
              </View>
              <Text style={[s.cell, { flex: 1, textAlign: "right" }]}>{l.quantity}</Text>
              <Text style={[s.cell, { flex: 2, textAlign: "right" }]}>
                {amount(l.unitPriceTtc)}
              </Text>
              <Text style={[s.cell, { flex: 2, textAlign: "right" }]}>{amount(l.totalTtc)}</Text>
            </View>
          ))}
        </View>

        <View style={{ marginTop: 10, alignSelf: "flex-end", width: "60%" }}>
          {d.taxes.map((t) => (
            <View key={t.category} style={[s.row, { justifyContent: "space-between" }]}>
              <Text style={s.muted}>
                {t.category === "exempt" ? "Exonéré de TVA" : `TVA ${pct(t.rate)}`} — base HT{" "}
                {amount(t.baseHt)}
              </Text>
              <Text>{amount(t.tax)}</Text>
            </View>
          ))}
          <View style={[s.row, { justifyContent: "space-between", marginTop: 4 }]}>
            <Text>Total HT</Text>
            <Text>{fcfa(d.totalHt)}</Text>
          </View>
          <View style={[s.row, { justifyContent: "space-between" }]}>
            <Text>TVA</Text>
            <Text>{fcfa(d.totalTax)}</Text>
          </View>
          <View style={[s.row, { justifyContent: "space-between", marginTop: 4 }]}>
            <Text style={s.total}>{d.kind === "credit_note" ? "Remboursé" : "Payé"}</Text>
            <Text style={s.total}>{fcfa(d.totalTtc)}</Text>
          </View>
          <Text style={[s.muted, { marginTop: 2 }]}>
            {MEANS[d.paymentMean]}
            {d.paymentReference ? ` · réf. ${d.paymentReference}` : ""}
          </Text>
        </View>

        {d.draftTax && (
          <Text style={s.warn}>
            TVA calculée avec un référentiel non encore validé par l'expert-comptable (pilote).
          </Text>
        )}
        <View style={[s.row, { marginTop: 14, alignItems: "center" }]}>
          <Image src={qr} style={{ width: 52, height: 52, marginRight: 8 }} />
          <View>
            <Text>Code de vérification : {d.verification.code}</Text>
            <Text style={s.muted}>{d.verification.url}</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}

export async function renderReceiptPdf(d: ReceiptPdfData): Promise<Buffer> {
  const qr = await QRCode.toDataURL(d.verification.url, { margin: 0, width: 200 });
  return renderToBuffer(<Receipt d={d} qr={qr} />);
}
