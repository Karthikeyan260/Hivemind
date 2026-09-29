"use client";

import { Download, FileText, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { useState } from "react";
import { Holo } from "@/components/bridge/holo";
import { Badge, Button, ErrorText, Textarea } from "@/components/ui";
import { summarizeTailored, useVoiceActions } from "@/components/voice/provider";
import { api, fmtDate, useFetch } from "@/lib/client-api";

type MasterStatus = { exists: boolean; updated_at?: string; name?: string; headline?: string; sections?: string[] };
type Tailored = {
  changes: string[];
  keywords_added: string[];
  not_added: string[];
  warnings: string[];
  created_at: string;
  resume: { headline: string };
};

/** Triggers a file download (the API responds with Content-Disposition: attachment). */
function download(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  a.click();
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function FileLinks({ base }: { base: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      <a href={`${base}?format=pdf`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 border border-data/30 px-2.5 py-1.5 font-mono text-[10.5px] tracking-widest text-soft hover:border-data hover:text-data">
        <FileText size={12} /> VIEW PDF
      </a>
      <a href={`${base}?format=pdf-download`} className="flex items-center gap-1.5 border border-core/50 bg-core/10 px-2.5 py-1.5 font-mono text-[10.5px] tracking-widest text-core hover:bg-core/20">
        <Download size={12} /> DOWNLOAD PDF
      </a>
      <a href={`${base}?format=tex`} className="flex items-center gap-1.5 border border-data/30 px-2.5 py-1.5 font-mono text-[10.5px] tracking-widest text-soft hover:border-data hover:text-data">
        <Download size={12} /> .TEX (OVERLEAF)
      </a>
    </div>
  );
}

/** The LaTeX resume every tailored version starts from. */
export function MasterResume() {
  const status = useFetch<MasterStatus>("/api/career/master");
  const [editing, setEditing] = useState(false);
  const [latex, setLatex] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const m = status.data;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/career/master", { method: "PUT", json: { latex } });
      setEditing(false);
      setLatex("");
      status.reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="hud-label mb-2">Master resume</div>
      <div className="space-y-2.5 border border-line p-3">
        {m?.exists ? (
          <>
            <div className="text-sm">
              <div className="font-medium">{m.name}</div>
              <div className="text-[12.5px] text-soft">{m.headline}</div>
              {m.updated_at && <div className="mt-1 font-mono text-[10px] text-faint">Updated {fmtDate(m.updated_at)} · {m.sections?.length ?? 0} sections</div>}
            </div>
            <FileLinks base="/api/career/master" />
          </>
        ) : (
          <p className="text-[12.5px] text-soft">{status.loading ? "Loading…" : "Paste your LaTeX resume once. Every job gets its own tailored copy from it."}</p>
        )}
        {editing || (!m?.exists && !status.loading) ? (
          <>
            <Textarea rows={8} placeholder="\documentclass… (full LaTeX source)" value={latex} onChange={(e) => setLatex(e.target.value)} className="font-mono text-[11px]" />
            <div className="flex gap-2">
              <Button size="sm" onClick={save} disabled={busy || latex.trim().length < 200}>
                {busy ? <Loader2 size={13} className="animate-spin" /> : null} Save master
              </Button>
              {m?.exists && (
                <Button size="sm" variant="quiet" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              )}
            </div>
            <ErrorText error={error} />
          </>
        ) : (
          <button type="button" onClick={() => setEditing(true)} className="font-mono text-[10px] tracking-widest text-soft hover:text-core">
            REPLACE LATEX
          </button>
        )}
      </div>
    </div>
  );
}

/** Per-job copy of the master resume with evidence-backed keyword updates, previewed and downloadable as PDF. */
export function TailoredResume({ analysisId }: { analysisId: string }) {
  const base = `/api/career/${analysisId}/resume`;
  const tailored = useFetch<Tailored | null>(base);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const t = tailored.data;

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const out = await api<Tailored>(base, { method: "POST" });
      tailored.setData(out);
      setVersion((v) => v + 1);
      return out;
    } catch (e) {
      setError(errMsg(e));
      throw e;
    } finally {
      setBusy(false);
    }
  }

  const needResume = { error: "No tailored resume for this job yet. Generate it first." };
  useVoiceActions({
    generate_resume: {
      description: "Generate (or regenerate) the tailored resume PDF for the open job analysis.",
      run: async () => summarizeTailored(await generate()),
    },
    download_resume_pdf: {
      description: "Download the tailored resume as a PDF.",
      run: () => {
        if (!t) return needResume;
        download(`${base}?format=pdf-download`);
        return { downloading: true };
      },
    },
    view_resume_pdf: {
      description: "Open the tailored resume PDF in a new tab.",
      run: () => {
        if (!t) return needResume;
        window.open(`${base}?format=pdf`, "_blank");
        return { opened: true };
      },
    },
    download_resume_tex: {
      description: "Download the tailored resume as a LaTeX .tex file for Overleaf.",
      run: () => {
        if (!t) return needResume;
        download(`${base}?format=tex`);
        return { downloading: true };
      },
    },
  });

  const action = (
    <button type="button" onClick={() => generate().catch(() => {})} disabled={busy} className="flex items-center gap-1 font-mono text-[10px] tracking-widest text-soft hover:text-core disabled:opacity-50">
      {busy ? <Loader2 size={12} className="animate-spin" /> : t ? <RefreshCw size={12} /> : <Sparkles size={12} />} {t ? "REGENERATE" : "GENERATE"}
    </button>
  );

  return (
    <Holo title="Tailored resume · PDF" right={action} tone="core">
      {!t ? (
        <div className="space-y-3 p-5">
          <p className="text-[13.5px] text-soft">
            {tailored.loading
              ? "Loading…"
              : "Builds a copy of your master resume for this job: same layout, reworded toward the job's keywords. A keyword is only added where your brain has evidence for it. No new metrics, no invented experience."}
          </p>
          {!tailored.loading && (
            <Button onClick={() => generate().catch(() => {})} disabled={busy}>
              {busy ? (
                <>
                  <Loader2 size={15} className="animate-spin" /> Tailoring your resume… (about 20 seconds)
                </>
              ) : (
                <>
                  <Sparkles size={15} /> Generate tailored resume
                </>
              )}
            </Button>
          )}
          <ErrorText error={error} />
        </div>
      ) : (
        <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <div className="space-y-4 p-5">
            <div>
              <div className="text-[13.5px] font-medium">{t.resume.headline}</div>
              <div className="font-mono text-[10px] text-faint">Generated {fmtDate(t.created_at)}</div>
            </div>
            <FileLinks base={base} />
            <ErrorText error={error} />
            <div>
              <div className="hud-label mb-1.5 text-ok">Keywords added ({t.keywords_added.length})</div>
              {t.keywords_added.length ? (
                <div className="flex flex-wrap gap-1">
                  {t.keywords_added.map((k) => (
                    <Badge key={k} tone="ok">
                      {k}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-[12.5px] text-soft">
                  No new keywords. {t.changes.length ? "The resume was reworded around the skills you already match (see What changed)." : "Nothing in your brain backs the missing ones yet."}
                </p>
              )}
            </div>
            {t.not_added.length > 0 && (
              <div>
                <div className="hud-label mb-1.5 text-alert">Left out: no evidence ({t.not_added.length})</div>
                <div className="flex flex-wrap gap-1">
                  {t.not_added.map((k) => (
                    <span key={k} className="rounded-sm bg-alert/10 px-1.5 py-0.5 font-mono text-[10.5px] uppercase tracking-wider text-alert">
                      {k}
                    </span>
                  ))}
                </div>
                <p className="mt-1 text-[11.5px] text-faint">Build or record real work with these, then regenerate.</p>
              </div>
            )}
            {t.changes.length > 0 && (
              <div>
                <div className="hud-label mb-1.5">What changed</div>
                <ul className="space-y-1">
                  {t.changes.map((c, i) => (
                    <li key={i} className="flex gap-2 text-[12.5px]">
                      <span className="mt-[0.55em] h-1 w-1 shrink-0 bg-core" />
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {t.warnings.length > 0 && (
              <div>
                <div className="hud-label mb-1.5 text-data">Honesty guardrails</div>
                <ul className="space-y-1">
                  {t.warnings.map((w, i) => (
                    <li key={i} className="text-[12px] text-soft">
                      {w}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="border-t border-data/15 p-3 xl:border-l xl:border-t-0">
            <iframe key={version} src={`${base}?format=pdf#view=FitH`} title="Tailored resume preview" className="h-[640px] w-full bg-white" />
          </div>
        </div>
      )}
    </Holo>
  );
}
