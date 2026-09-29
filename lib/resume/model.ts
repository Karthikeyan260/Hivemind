// Structured resume model + round-trip with the owner's LaTeX template
// (\section, \datedEntry, \resumeItem, \skill, multicols, \columnbreak).

export type Entry = { title: string; dates: string; subtitle: string; bullets: string[]; footer: string };
export type Section =
  | { kind: "text"; title: string; column: 1 | 2; text: string }
  | { kind: "entries"; title: string; column: 1 | 2; entries: Entry[] }
  | { kind: "list"; title: string; column: 1 | 2; items: string[] }
  | { kind: "skills"; title: string; column: 1 | 2; rows: { label: string; items: string }[] }
  | { kind: "projects"; title: string; column: 1 | 2; projects: { name: string; bullets: string[] }[] };

export type Resume = {
  name: string;
  headline: string;
  contacts: { email?: string; phone?: string; github?: string; linkedin?: string; website?: string };
  sections: Section[];
};

/* ───────────── LaTeX → plain text helpers ───────────── */

/** Reads a balanced {...} group starting at s[i] === "{". Returns [content, indexAfter]. */
function group(s: string, i: number): [string, number] {
  if (s[i] !== "{") return ["", i];
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === "\\") {
      j++;
      continue;
    }
    if (s[j] === "{") depth++;
    else if (s[j] === "}" && --depth === 0) return [s.slice(i + 1, j), j + 1];
  }
  return [s.slice(i + 1), s.length];
}

/** All occurrences of \cmd{a}{b}… with `n` balanced args. */
function commands(s: string, cmd: string, n: number) {
  const out: { args: string[]; start: number; end: number }[] = [];
  const re = new RegExp(`\\\\${cmd}(?![a-zA-Z])`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    let i = m.index + m[0].length;
    const args: string[] = [];
    for (let k = 0; k < n; k++) {
      while (s[i] === " ") i++;
      const [a, next] = group(s, i);
      args.push(a);
      i = next;
    }
    out.push({ args, start: m.index, end: i });
  }
  return out;
}

export function plain(tex: string): string {
  let s = tex;
  // unwrap simple formatting commands, keep their text
  for (const c of ["textbf", "textit", "emph", "underline", "mbox"]) {
    let prev;
    do {
      prev = s;
      s = s.replace(new RegExp(`\\\\${c}\\{([^{}]*)\\}`, "g"), "$1");
    } while (s !== prev);
  }
  s = s
    .replace(/\\href\{[^{}]*\}\{([^{}]*)\}/g, "$1")
    .replace(/\\color\{[^{}]*\}/g, "")
    .replace(/\$\s*\|\s*\$/g, "|")
    .replace(/\$\\;\\;\$/g, " ")
    .replace(/\\\\(\[[^\]]*\])?/g, " ")
    .replace(/\\([%&$#_{}])/g, "$1")
    .replace(/---/g, "—")
    .replace(/--/g, "–")
    .replace(/~/g, " ")
    .replace(/\\[a-zA-Z]+\*?/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return s;
}

/** Escape plain text for LaTeX. */
export function esc(text: string): string {
  return text
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/–/g, "--")
    .replace(/—/g, "---");
}

/* ───────────── Parse ───────────── */

function items(block: string) {
  return commands(block, "resumeItem", 1).map((c) => plain(c.args[0]));
}

export function parseLatex(latex: string): Resume {
  const body = latex.split("\\begin{document}")[1]?.split("\\end{document}")[0] ?? latex;

  const center = body.match(/\\begin\{center\}([\s\S]*?)\\end\{center\}/)?.[1] ?? "";
  const lines = center.split(/\\\\(?:\[[^\]]*\])?/).map((l) => l.trim()).filter(Boolean);
  const name = plain(lines[0] ?? "");
  const headline = plain(lines[1] ?? "");
  const hrefs = commands(center, "href", 2).map((h) => ({ url: h.args[0], text: plain(h.args[1]) }));
  const contacts: Resume["contacts"] = {};
  for (const h of hrefs) {
    if (h.url.startsWith("mailto:")) contacts.email = h.url.replace("mailto:", "");
    else if (/github\.com/i.test(h.url)) contacts.github = h.url;
    else if (/linkedin\.com/i.test(h.url)) contacts.linkedin = h.url;
    else contacts.website = h.url;
  }
  contacts.phone = center.match(/\+?\d[\d\s-]{8,}\d/)?.[0]?.trim();

  const colBreak = body.indexOf("\\columnbreak");
  const parts = [...body.matchAll(/\\section\*?\{([^}]*)\}/g)];
  const sections: Section[] = [];
  parts.forEach((m, idx) => {
    const title = plain(m[1]);
    const start = m.index! + m[0].length;
    const end = idx + 1 < parts.length ? parts[idx + 1].index! : body.search(/\\end\{multicols\}/) > start ? body.search(/\\end\{multicols\}/) : body.length;
    const block = body.slice(start, end).replace(/\\columnbreak/g, "");
    const column: 1 | 2 = colBreak >= 0 && m.index! > colBreak ? 2 : 1;

    const skillRows = commands(block, "skill", 2);
    const dated = commands(block, "datedEntry", 2);
    if (skillRows.length) {
      sections.push({ kind: "skills", title, column, rows: skillRows.map((r) => ({ label: plain(r.args[0]), items: plain(r.args[1]) })) });
    } else if (dated.length) {
      const entries: Entry[] = dated.map((d, k) => {
        const seg = block.slice(d.end, k + 1 < dated.length ? dated[k + 1].start : block.length);
        const subtitle = plain(seg.split(/\\begin\{itemize\}|\\textbf\{Key/)[0] ?? "");
        const footer = seg.match(/\\textbf\{Key Skills:\}([\s\S]*?)(?=\\datedEntry|$)/)?.[1] ?? "";
        return { title: plain(d.args[0]), dates: plain(d.args[1]), subtitle, bullets: items(seg), footer: plain(footer) };
      });
      sections.push({ kind: "entries", title, column, entries });
    } else if (/\\textbf\{[^}]+\}\s*\\begin\{itemize\}/.test(block)) {
      const projects = [...block.matchAll(/\\textbf\{([^}]+)\}\s*\\begin\{itemize\}([\s\S]*?)\\end\{itemize\}/g)].map((p) => ({
        name: plain(p[1]),
        bullets: items(p[2]),
      }));
      sections.push({ kind: "projects", title, column, projects });
    } else if (/\\resumeItem/.test(block)) {
      sections.push({ kind: "list", title, column, items: items(block) });
    } else {
      sections.push({ kind: "text", title, column, text: plain(block) });
    }
  });
  return { name, headline, contacts, sections };
}

/* ───────────── Render back to the same template ───────────── */

const DEFAULT_PREAMBLE = String.raw`\documentclass[10pt]{article}
\usepackage[margin=0.55in]{geometry}
\usepackage{amsmath,amssymb}
\usepackage{multicol}
\usepackage{xcolor}
\usepackage[hidelinks]{hyperref}
\usepackage{enumitem}
\usepackage{titlesec}
\setlength{\parindent}{0pt}
\setlength{\parskip}{0pt}
\setlength{\columnsep}{0.28in}
\pagestyle{empty}
\definecolor{resumeBlack}{RGB}{0,0,0}
\definecolor{resumeBlue}{RGB}{0,82,155}
\color{resumeBlack}
\hypersetup{colorlinks=true, urlcolor=resumeBlue, linkcolor=resumeBlue}
\titleformat{\section}{\large\bfseries\color{resumeBlue}}{}{0pt}{}[\color{resumeBlue}\titlerule]
\titlespacing*{\section}{0pt}{7pt}{4pt}
\setlist[itemize]{leftmargin=*, nosep, topsep=2pt}
\newcommand{\resumeItem}[1]{\item #1}
\newcommand{\datedEntry}[2]{\textbf{#1}\hfill #2}
\newcommand{\skill}[2]{\textbf{#1:} #2\par}
`;

function sectionTex(s: Section) {
  const head = `\\section{${esc(s.title)}}\n`;
  const itemize = (b: string[]) => (b.length ? `\\begin{itemize}\n${b.map((x) => `    \\resumeItem{${esc(x)}}`).join("\n")}\n\\end{itemize}\n` : "");
  switch (s.kind) {
    case "text":
      return head + esc(s.text) + "\n";
    case "list":
      return head + itemize(s.items);
    case "skills":
      return head + s.rows.map((r) => `\\skill{${esc(r.label)}}{${esc(r.items)}}`).join("\n") + "\n";
    case "projects":
      return head + s.projects.map((p) => `\\textbf{${esc(p.name)}}\n${itemize(p.bullets)}`).join("\n");
    case "entries":
      return (
        head +
        s.entries
          .map(
            (e) =>
              `\\datedEntry{${esc(e.title)}}{${esc(e.dates)}}\\\\\n${esc(e.subtitle)}\n${itemize(e.bullets)}${e.footer ? `\\textbf{Key Skills:} ${esc(e.footer)}\n` : ""}`,
          )
          .join("\n")
      );
  }
}

/** Regenerates LaTeX in the owner's template (their original preamble is kept verbatim when available). */
export function toLatex(r: Resume, originalLatex?: string): string {
  const preamble = originalLatex?.includes("\\begin{document}") ? originalLatex.split("\\begin{document}")[0] : DEFAULT_PREAMBLE;
  const c = r.contacts;
  const contactLine = [
    c.email ? `\\href{mailto:${c.email}}{${esc(c.email)}}` : "",
    c.phone ? esc(c.phone) : "",
    c.github ? `\\href{${c.github}}{${esc(c.github.replace(/^https?:\/\//, ""))}}` : "",
    c.linkedin ? `\\href{${c.linkedin}}{${esc(c.linkedin.replace(/^https?:\/\/(www\.)?/, ""))}}` : "",
  ]
    .filter(Boolean)
    .join(" $\\;\\;$\n    ");
  const header = `\\begin{center}
    {\\LARGE \\textbf{\\color{resumeBlue}${esc(r.name)}}}\\\\[2pt]
    {\\color{resumeBlue}${esc(r.headline).replace(/\s*\|\s*/g, " $|$ ")}}\\\\[2pt]
    ${contactLine}${c.website ? `\\\\\n    \\href{${c.website}}{${esc(c.website.replace(/^https?:\/\//, ""))}}` : ""}
\\end{center}
`;
  const col1 = r.sections.filter((s) => s.column === 1).map(sectionTex).join("\n");
  const col2 = r.sections.filter((s) => s.column === 2).map(sectionTex).join("\n");
  return `${preamble}\\begin{document}

${header}
\\begin{multicols}{2}

${col1}
${col2 ? `\\columnbreak\n\n${col2}` : ""}
\\end{multicols}

\\end{document}
`;
}

/** Flat text, used for search/ATS matching and to check that tailoring invents nothing. */
export function resumeText(r: Resume): string {
  const out = [r.name, r.headline];
  for (const s of r.sections) {
    out.push(s.title);
    if (s.kind === "text") out.push(s.text);
    if (s.kind === "list") out.push(...s.items);
    if (s.kind === "skills") out.push(...s.rows.map((x) => `${x.label}: ${x.items}`));
    if (s.kind === "projects") for (const p of s.projects) out.push(p.name, ...p.bullets);
    if (s.kind === "entries") for (const e of s.entries) out.push(`${e.title} ${e.dates} ${e.subtitle}`, ...e.bullets, e.footer);
  }
  return out.filter(Boolean).join("\n");
}
