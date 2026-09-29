import "server-only";
import { toLatex, type Resume } from "./model";
import { resumePdf } from "./pdf";

const safe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);

/** Serves a resume as a PDF (same design as the LaTeX template) or as a .tex file for Overleaf. */
export async function resumeResponse(resume: Resume, format: string, opts: { latex?: string; suffix?: string } = {}) {
  const base = `${safe(resume.name) || "Resume"}_Resume${opts.suffix ? `_${safe(opts.suffix)}` : ""}`;
  if (format === "tex") {
    return new Response(toLatex(resume, opts.latex), {
      headers: { "Content-Type": "application/x-tex; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.tex"` },
    });
  }
  const pdf = await resumePdf(resume);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      // inline so the browser can preview it; the download button sets the filename
      "Content-Disposition": `${format === "pdf-download" ? "attachment" : "inline"}; filename="${base}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
