import { describe, expect, it } from "vitest";
import { esc, parseLatex, plain, resumeText, toLatex, type Resume } from "@/lib/resume/model";

const sample: Resume = {
  name: "Asha K",
  headline: "AI Engineer & Builder",
  contacts: { email: "a@b.co", phone: "+91 90000 00000", github: "github.com/asha_k" },
  sections: [
    { kind: "text", title: "Summary", column: 1, text: "Builds 100% reliable agents & tools, e.g. C# / R_2 #1 {not a group}." },
    { kind: "entries", title: "Experience", column: 1, entries: [{ title: "Engineer", dates: "2024 - now", subtitle: "Acme_Co & Sons", bullets: ["Cut cost by 40% (from $5k)", "Wrote ~/scripts_v2 with #tags"], footer: "" }] },
    { kind: "skills", title: "Skills", column: 2, rows: [{ label: "Languages", items: "Python, C++, R" }] },
  ],
};

describe("resume LaTeX round trip", () => {
  it("escapes the characters LaTeX treats as commands", () => {
    const e = esc("50% & #1 _x_ {y} $5");
    // every special character is preceded by a backslash
    expect(e).not.toMatch(/(?<!\\)[%&#_{}$]/);
  });
  it("keeps the text through write then read", () => {
    const back = parseLatex(toLatex(sample));
    expect(back.name).toBe("Asha K");
    const text = resumeText(back);
    for (const must of ["100% reliable", "Acme_Co & Sons", "Cut cost by 40% (from $5k)", "Languages"]) expect(text).toContain(must);
  });
  it("never throws or hangs on broken LaTeX", () => {
    const junk = [
      "",
      "{{{{{{{{",
      "}}}}}}}}",
      "\section{",
      "\section{A}\datedEntry{",
      "\resumeItem{unclosed",
      "\\\\\\\\\\\\\\",
      "\begin{multicols}{2}",
      "\section{A}" + "\resumeItem{x}".repeat(2000),
      "%" + "x".repeat(50_000),
      "\datedEntry".repeat(500),
      "\u0000‮ emoji 🌸 தமிழ்",
    ];
    const t0 = Date.now();
    for (const j of junk) {
      expect(() => parseLatex(j)).not.toThrow();
      expect(() => plain(j)).not.toThrow();
    }
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});
