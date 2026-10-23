import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import QRCode from "qrcode";
import { amount, isoToDisplay, labels, lineLabel, monthLabel, percent, type Lang } from "./labels";

export interface PayslipPdfData {
  language: Lang;
  employer: { legalName: string; niu: string; cnpsEmployerNumber: string; commune: string };
  employee: {
    lastName: string;
    firstNames: string;
    matricule: string;
    jobTitle: string;
    category: string;
    echelon: string;
    hireDate: string;
    contractType: string;
    cnpsNumber: string | null;
  };
  period: { year: number; month: number };
  lines: {
    code: string;
    label: string;
    section: string;
    base: number | null;
    rate: number | null;
    amount: number;
  }[];
  totals: {
    gross: number;
    employeeContributions: number;
    deductions: number;
    netPay: number;
    employerCost: number;
  };
  ytd: { gross: number; irpp: number; netPay: number };
  itemLabelsEn?: Record<string, string>;
}

export interface PdfOptions {
  /** Filigrane (ex. « APERÇU — PROVISOIRE ») : jamais sur un bulletin définitif. */
  watermark?: string;
  verification?: { code: string; url: string };
}

const s = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: "Helvetica", color: "#1c1917" },
  row: { flexDirection: "row" },
  h1: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  muted: { color: "#57534e" },
  box: { borderWidth: 1, borderColor: "#d6d3d1", borderRadius: 4, padding: 8, flex: 1 },
  boxTitle: { fontFamily: "Helvetica-Bold", marginBottom: 4, fontSize: 10 },
  kv: { flexDirection: "row", marginBottom: 1 },
  k: { width: 95, color: "#57534e" },
  section: { fontFamily: "Helvetica-Bold", fontSize: 10, marginTop: 10, marginBottom: 3 },
  th: {
    flexDirection: "row",
    backgroundColor: "#f5f5f4",
    paddingVertical: 3,
    paddingHorizontal: 4,
    fontFamily: "Helvetica-Bold",
  },
  tr: {
    flexDirection: "row",
    paddingVertical: 2,
    paddingHorizontal: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e7e5e4",
  },
  cLabel: { flex: 1 },
  cBase: { width: 80, textAlign: "right" },
  cRate: { width: 50, textAlign: "right" },
  cAmount: { width: 80, textAlign: "right" },
  total: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  net: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "#0f7a4a",
    color: "#ffffff",
    padding: 8,
    marginTop: 6,
    fontFamily: "Helvetica-Bold",
    fontSize: 13,
    borderRadius: 4,
  },
  watermark: {
    position: "absolute",
    top: 360,
    left: 40,
    fontSize: 46,
    color: "#dc2626",
    opacity: 0.18,
    transform: "rotate(-30deg)",
    fontFamily: "Helvetica-Bold",
  },
  footer: {
    position: "absolute",
    bottom: 28,
    left: 32,
    right: 32,
    flexDirection: "row",
    alignItems: "center",
  },
});

const SECTIONS = [
  "earning",
  "allowance",
  "employee_contribution",
  "deduction",
  "employer_contribution",
] as const;

function KV({ k, v }: { k: string; v: string }) {
  return (
    <View style={s.kv}>
      <Text style={s.k}>{k}</Text>
      <Text>{v}</Text>
    </View>
  );
}

function PayslipDocument({ d, o, qr }: { d: PayslipPdfData; o: PdfOptions; qr: string | null }) {
  const t = labels(d.language);
  const period = monthLabel(d.language, d.period.year, d.period.month);
  return (
    <Document
      title={`${t.title} ${period} — ${d.employee.lastName}`}
      author={d.employer.legalName}
      language={d.language}
    >
      <Page size="A4" style={s.page}>
        {o.watermark && (
          <Text style={s.watermark} fixed>
            {o.watermark}
          </Text>
        )}
        <View style={[s.row, { justifyContent: "space-between", marginBottom: 10 }]}>
          <View>
            <Text style={s.h1}>{t.title}</Text>
            <Text style={s.muted}>
              {t.period} : {period}
            </Text>
          </View>
        </View>

        <View style={[s.row, { gap: 8 }]}>
          <View style={s.box}>
            <Text style={s.boxTitle}>{t.employer}</Text>
            <Text style={{ fontFamily: "Helvetica-Bold", marginBottom: 2 }}>
              {d.employer.legalName}
            </Text>
            <KV k={t.niu} v={d.employer.niu} />
            <KV k={t.cnpsEmployer} v={d.employer.cnpsEmployerNumber} />
            <KV k={t.commune} v={d.employer.commune} />
          </View>
          <View style={s.box}>
            <Text style={s.boxTitle}>{t.employee}</Text>
            <Text style={{ fontFamily: "Helvetica-Bold", marginBottom: 2 }}>
              {d.employee.lastName} {d.employee.firstNames}
            </Text>
            <KV k={t.matricule} v={d.employee.matricule} />
            <KV k={t.job} v={d.employee.jobTitle} />
            <KV k={t.category} v={`${d.employee.category} / ${d.employee.echelon}`} />
            <KV k={t.hireDate} v={isoToDisplay(d.employee.hireDate)} />
            <KV
              k={t.contract}
              v={t.contracts[d.employee.contractType] ?? d.employee.contractType}
            />
            <KV k={t.cnpsNumber} v={d.employee.cnpsNumber ?? t.notProvided} />
          </View>
        </View>

        {SECTIONS.map((section) => {
          const rows = d.lines.filter((l) => l.section === section);
          if (rows.length === 0) return null;
          return (
            <View key={section} wrap={false}>
              <Text style={s.section}>{t.sections[section]}</Text>
              <View style={s.th}>
                <Text style={s.cLabel}>{t.item}</Text>
                <Text style={s.cBase}>{t.base}</Text>
                <Text style={s.cRate}>{t.rate}</Text>
                <Text style={s.cAmount}>{t.amount}</Text>
              </View>
              {rows.map((l, i) => (
                <View key={`${l.code}-${i}`} style={s.tr}>
                  <Text style={s.cLabel}>
                    {lineLabel(l.code, l.label, d.language, d.itemLabelsEn)}
                  </Text>
                  <Text style={s.cBase}>{l.base === null ? "" : amount(l.base)}</Text>
                  <Text style={s.cRate}>{l.rate === null ? "" : percent(l.rate)}</Text>
                  <Text style={s.cAmount}>{amount(l.amount)}</Text>
                </View>
              ))}
            </View>
          );
        })}

        <View style={[s.row, { gap: 8, marginTop: 12 }]} wrap={false}>
          <View style={s.box}>
            <Text style={s.boxTitle}>{t.ytd}</Text>
            <KV k={t.ytdGross} v={amount(d.ytd.gross)} />
            <KV k={t.ytdIrpp} v={amount(d.ytd.irpp)} />
            <KV k={t.ytdNet} v={amount(d.ytd.netPay)} />
          </View>
          <View style={{ flex: 1.3 }}>
            <View style={s.total}>
              <Text>{t.gross}</Text>
              <Text>{amount(d.totals.gross)} FCFA</Text>
            </View>
            <View style={s.total}>
              <Text>{t.totalDeductions}</Text>
              <Text>{amount(d.totals.employeeContributions + d.totals.deductions)} FCFA</Text>
            </View>
            <View style={s.total}>
              <Text style={s.muted}>{t.employerCost}</Text>
              <Text style={s.muted}>{amount(d.totals.employerCost)} FCFA</Text>
            </View>
            <View style={s.net}>
              <Text>{t.netPay}</Text>
              <Text>{amount(d.totals.netPay)} FCFA</Text>
            </View>
          </View>
        </View>

        <View style={s.footer} fixed>
          {qr && <Image src={qr} style={{ width: 56, height: 56, marginRight: 8 }} />}
          <View style={{ flex: 1 }}>
            {o.verification && (
              <>
                <Text>{t.verify} :</Text>
                <Text style={s.muted}>{o.verification.url}</Text>
                <Text>
                  {t.code} : {o.verification.code}
                </Text>
              </>
            )}
            <Text style={[s.muted, { marginTop: 2 }]}>{t.keep}</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}

/** Rend un bulletin en PDF (Buffer). Fonction pure : aucune lecture en base. */
export async function renderPayslipPdf(
  data: PayslipPdfData,
  options: PdfOptions = {},
): Promise<Buffer> {
  const qr = options.verification
    ? await QRCode.toDataURL(options.verification.url, { margin: 0, width: 200 })
    : null;
  return renderToBuffer(<PayslipDocument d={data} o={options} qr={qr} />);
}
