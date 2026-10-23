/** @jsxRuntime automatic */
/** @jsxImportSource react */
// Transformation JSX imposée dans le fichier : le worker (tsx) n'utilise pas la configuration du package.
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

export interface DataExportSection {
  title: string;
  /** Paires libellé / valeur, ou tableau (en-têtes + lignes). */
  fields?: [string, string][];
  table?: { headers: string[]; rows: string[][] };
  note?: string;
}

const s = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: "Helvetica", color: "#1c1917" },
  h1: { fontSize: 15, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  muted: { color: "#57534e", marginBottom: 10 },
  h2: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 12, marginBottom: 4 },
  kv: { flexDirection: "row", marginBottom: 1 },
  k: { width: 160, color: "#57534e" },
  th: {
    flexDirection: "row",
    backgroundColor: "#f5f5f4",
    fontFamily: "Helvetica-Bold",
    paddingVertical: 2,
  },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#e7e5e4",
    paddingVertical: 2,
  },
  cell: { flex: 1, paddingHorizontal: 2 },
});

/** Export des données d'une personne (droit d'accès) : document lisible, sans mise en forme métier. */
export async function renderDataExportPdf(input: {
  title: string;
  subtitle: string;
  sections: DataExportSection[];
}): Promise<Buffer> {
  return renderToBuffer(
    <Document title={input.title} language="fr">
      <Page size="A4" style={s.page} wrap>
        <Text style={s.h1}>{input.title}</Text>
        <Text style={s.muted}>{input.subtitle}</Text>
        {input.sections.map((sec, i) => (
          <View key={i} wrap>
            <Text style={s.h2}>{sec.title}</Text>
            {sec.note && <Text style={s.muted}>{sec.note}</Text>}
            {sec.fields?.map(([k, v], j) => (
              <View key={j} style={s.kv}>
                <Text style={s.k}>{k}</Text>
                <Text>{v}</Text>
              </View>
            ))}
            {sec.table && (
              <View>
                <View style={s.th}>
                  {sec.table.headers.map((h, j) => (
                    <Text key={j} style={s.cell}>
                      {h}
                    </Text>
                  ))}
                </View>
                {sec.table.rows.map((r, j) => (
                  <View key={j} style={s.tr} wrap={false}>
                    {r.map((c, k) => (
                      <Text key={k} style={s.cell}>
                        {c}
                      </Text>
                    ))}
                  </View>
                ))}
              </View>
            )}
          </View>
        ))}
      </Page>
    </Document>,
  );
}
