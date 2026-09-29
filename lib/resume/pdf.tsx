import "server-only";
import { Document, Link, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { Resume, Section } from "./model";

// Mirrors the LaTeX template: US Letter, 0.55in margins, 10pt serif, blue name + ruled blue section titles,
// two columns with a 0.28in gap.
const BLUE = "#00529B";
const IN = 72;

const s = StyleSheet.create({
  page: { paddingVertical: 0.55 * IN, paddingHorizontal: 0.55 * IN, fontFamily: "Times-Roman", fontSize: 9.6, lineHeight: 1.22, color: "#000" },
  name: { fontFamily: "Times-Bold", fontSize: 17.3, lineHeight: 1.15, color: BLUE, textAlign: "center", marginBottom: 3 },
  headline: { color: BLUE, textAlign: "center", fontSize: 9.8 },
  contacts: { textAlign: "center", marginTop: 2, fontSize: 9.4 },
  link: { color: BLUE, textDecoration: "none" },
  cols: { flexDirection: "row", marginTop: 6 },
  col: { flex: 1 },
  gap: { width: 0.28 * IN },
  sectionTitle: { fontFamily: "Times-Bold", fontSize: 11.5, color: BLUE, marginTop: 7, paddingBottom: 1.5, borderBottomWidth: 0.6, borderBottomColor: BLUE, marginBottom: 4 },
  bold: { fontFamily: "Times-Bold" },
  row: { flexDirection: "row", justifyContent: "space-between" },
  bulletRow: { flexDirection: "row", marginTop: 1 },
  bullet: { width: 9 },
  bulletText: { flex: 1 },
  entry: { marginBottom: 3 },
  para: { textAlign: "justify" },
});

function Bullets({ items }: { items: string[] }) {
  return (
    <View style={{ marginTop: 1.5 }}>
      {items.map((b, i) => (
        <View key={i} style={s.bulletRow} wrap={false}>
          <Text style={s.bullet}>•</Text>
          <Text style={s.bulletText}>{b}</Text>
        </View>
      ))}
    </View>
  );
}

function SectionView({ sec }: { sec: Section }) {
  return (
    <View>
      <Text style={s.sectionTitle}>{sec.title}</Text>
      {sec.kind === "text" && <Text style={s.para}>{sec.text}</Text>}
      {sec.kind === "list" && <Bullets items={sec.items} />}
      {sec.kind === "skills" &&
        sec.rows.map((r, i) => (
          <Text key={i} style={{ marginBottom: 1 }}>
            <Text style={s.bold}>{r.label}: </Text>
            {r.items}
          </Text>
        ))}
      {sec.kind === "projects" &&
        sec.projects.map((p, i) => (
          <View key={i} style={s.entry} wrap={false}>
            <Text style={s.bold}>{p.name}</Text>
            <Bullets items={p.bullets} />
          </View>
        ))}
      {sec.kind === "entries" &&
        sec.entries.map((e, i) => (
          <View key={i} style={s.entry}>
            <View style={s.row}>
              <Text style={s.bold}>{e.title}</Text>
              <Text>{e.dates}</Text>
            </View>
            {e.subtitle ? <Text>{e.subtitle}</Text> : null}
            {e.bullets.length ? <Bullets items={e.bullets} /> : null}
            {e.footer ? (
              <Text style={{ marginTop: 1.5 }}>
                <Text style={s.bold}>Key Skills: </Text>
                {e.footer}
              </Text>
            ) : null}
          </View>
        ))}
    </View>
  );
}

function ResumeDoc({ r }: { r: Resume }) {
  const c = r.contacts;
  const short = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "");
  const parts: { text: string; href?: string }[] = [
    ...(c.email ? [{ text: c.email, href: `mailto:${c.email}` }] : []),
    ...(c.phone ? [{ text: c.phone }] : []),
    ...(c.github ? [{ text: short(c.github), href: c.github }] : []),
    ...(c.linkedin ? [{ text: short(c.linkedin), href: c.linkedin }] : []),
  ];
  return (
    <Document title={`${r.name} — Resume`} author={r.name}>
      <Page size="LETTER" style={s.page}>
        <Text style={s.name}>{r.name}</Text>
        <Text style={s.headline}>{r.headline}</Text>
        <Text style={s.contacts}>
          {parts.map((p, i) => (
            <Text key={i}>
              {i > 0 ? "   " : ""}
              {p.href ? (
                <Link src={p.href} style={s.link}>
                  {p.text}
                </Link>
              ) : (
                p.text
              )}
            </Text>
          ))}
        </Text>
        {c.website ? (
          <Text style={s.contacts}>
            <Link src={c.website} style={s.link}>
              {short(c.website)}
            </Link>
          </Text>
        ) : null}
        <View style={s.cols}>
          <View style={s.col}>
            {r.sections.filter((x) => x.column === 1).map((x, i) => (
              <SectionView key={i} sec={x} />
            ))}
          </View>
          <View style={s.gap} />
          <View style={s.col}>
            {r.sections.filter((x) => x.column === 2).map((x, i) => (
              <SectionView key={i} sec={x} />
            ))}
          </View>
        </View>
      </Page>
    </Document>
  );
}

export async function resumePdf(r: Resume): Promise<Buffer> {
  return renderToBuffer(<ResumeDoc r={r} />);
}
