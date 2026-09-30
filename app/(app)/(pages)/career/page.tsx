"use client";

import { Check, Copy, Loader2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Gauge, Holo } from "@/components/bridge/holo";
import { MasterResume, TailoredResume } from "@/components/career/resume";
import { summarizeAnalysis, useVoiceActions } from "@/components/voice/provider";
import { Badge, Button, cx, Empty, ErrorText, Input, PageHeader, Textarea } from "@/components/ui";
import { api, fmtDate, useFetch } from "@/lib/client-api";

type Analysis = {
  role: string;
  company: string;
  fit_score: number;
  ats_score: number;
  verdict: string;
  matched_keywords: string[];
  missing_keywords: string[];
  strengths: { point: string; evidence: string }[];
  gaps: { gap: string; how_to_close: string }[];
  tailored_summary: string;
  best_projects: { name: string; why: string; bullets: string[] }[];
  cover_letter: string;
  interview_questions: { q: string; hint: string }[];
  learning_plan: { skill: string; action: string }[];
  evidence: { title: string; type: string; href: string }[];
};
type HistoryItem = { id: string; title: string; created_at: string; role?: string; company?: string; fit_score?: number; ats_score?: number };
type Result = { id: string; created_at: string; analysis: Analysis; jobDescription?: string; model?: string };

export default function CareerPage() {
  return (
    <Suspense>
      <Career />
    </Suspense>
  );
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="flex items-center gap-1 font-mono text-[10px] tracking-widest text-soft hover:text-core"
    >
      {done ? <Check size={12} className="text-ok" /> : <Copy size={12} />} {done ? "COPIED" : label.toUpperCase()}
    </button>
  );
}

function toMarkdown(a: Analysis) {
  return [
    `# ${a.role}${a.company ? ` @ ${a.company}` : ""}`,
    `Fit ${a.fit_score}/100 · ATS keyword match ${a.ats_score}%`,
    `\n## Summary\n${a.tailored_summary}`,
    `\n## Relevant projects\n${a.best_projects.map((p) => `### ${p.name}\n${p.bullets.map((b) => `- ${b}`).join("\n")}`).join("\n\n")}`,
    `\n## Cover letter\n${a.cover_letter}`,
  ].join("\n");
}

function Career() {
  const router = useRouter();
  const openId = useSearchParams().get("open");
  const history = useFetch<HistoryItem[]>("/api/career");
  const opened = useFetch<Result>(openId ? `/api/career/${openId}` : null);
  const [jd, setJd] = useState("");
  const [role, setRole] = useState("");
  const [company, setCompany] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- show the analysis selected from history
    if (opened.data) setResult(opened.data);
  }, [opened.data]);

  // Phone: the result sits below the form and history, so bring it into view when one opens.
  const shownId = result?.id;
  useEffect(() => {
    if (shownId && window.innerWidth < 1024) setTimeout(() => document.getElementById("career-result")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }, [shownId]);

  async function runAnalysis(text: string, r = role, c = company) {
    setBusy(true);
    setError(null);
    try {
      const res = await api<Result>("/api/career", { method: "POST", json: { jobDescription: text, role: r || undefined, company: c || undefined } });
      setResult(res);
      router.replace(`/career?open=${res.id}`);
      history.reload();
      return res;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setBusy(false);
    }
  }

  function analyze(e: React.FormEvent) {
    e.preventDefault();
    runAnalysis(jd).catch(() => {});
  }

  useVoiceActions({
    analyse_job: {
      description: "Analyse the job description in the Career form (or one given as job_description) against the owner's profile.",
      run: async (args) => {
        // The pasted box wins unless the model passed a full job description of its own (not "this job").
        const given = String(args.job_description ?? args.input ?? "").trim();
        const text = given.length >= 200 || !jd.trim() ? given : jd.trim();
        if (text.length < 80) return { error: "The job description box is empty. Paste the job description there, or read it to me." };
        if (text !== jd) setJd(text);
        const r = args.role ? String(args.role) : role;
        const c = args.company ? String(args.company) : company;
        if (r !== role) setRole(r);
        if (c !== company) setCompany(c);
        return summarizeAnalysis(await runAnalysis(text, r, c));
      },
    },
    fill_job_description: {
      description: "Put the given text (input) into the job description box without analysing it yet.",
      run: ({ input }) => {
        setJd(String(input ?? ""));
        return { filled: true };
      },
    },
    open_analysis: {
      description: "Open a past analysis from history; input = part of the role or company name.",
      run: ({ input }) => {
        const q = String(input ?? "").toLowerCase();
        const hit = history.data?.find((h) => `${h.role} ${h.company}`.toLowerCase().includes(q));
        if (!hit) return { error: `No analysis matching "${input}". Available: ${history.data?.map((h) => `${h.role} @ ${h.company}`).join("; ") || "none"}` };
        router.replace(`/career?open=${hit.id}`);
        return { opened: `${hit.role} @ ${hit.company}`, fit: hit.fit_score, ats: hit.ats_score };
      },
    },
  });

  async function remove(id: string) {
    if (!confirm("Delete this analysis?")) return;
    await api(`/api/career/${id}`, { method: "DELETE" });
    if (result?.id === id) {
      setResult(null);
      router.replace("/career");
    }
    history.reload();
  }

  const a = result?.analysis;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Career"
        title="Job match"
        subtitle="Paste a job description. HIVEMIND matches it against your real resume, projects, experience and skills, then builds a tailored resume PDF, cover letter and interview prep. It never invents experience."
      />

      <div className="grid gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
        {/* Input + history */}
        <div className="min-w-0 space-y-5">
          <form onSubmit={analyze} className="space-y-2.5">
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Role (optional)" value={role} onChange={(e) => setRole(e.target.value)} />
              <Input placeholder="Company (optional)" value={company} onChange={(e) => setCompany(e.target.value)} />
            </div>
            <Textarea rows={12} required placeholder="Paste the full job description here…" value={jd} onChange={(e) => setJd(e.target.value)} />
            <Button type="submit" disabled={busy || jd.trim().length < 80} className="w-full">
              {busy ? (
                <>
                  <Loader2 size={15} className="animate-spin" /> Matching against your brain…
                </>
              ) : (
                "Analyse match"
              )}
            </Button>
            <ErrorText error={error} />
          </form>

          <MasterResume />

          <div>
            <div className="hud-label mb-2">History</div>
            {!history.data?.length ? (
              <p className="text-sm text-soft">No analyses yet.</p>
            ) : (
              <ul className="space-y-1">
                {history.data.map((h) => (
                  <li key={h.id} className="group flex items-center gap-2">
                    <Link
                      href={`/career?open=${h.id}`}
                      className={cx(
                        "flex min-w-0 flex-1 items-center gap-3 border px-3 py-2 text-sm transition-colors",
                        result?.id === h.id ? "border-core/60 bg-core/10" : "border-line hover:border-line-strong",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {h.role}
                        {h.company ? <span className="text-soft"> @ {h.company}</span> : null}
                      </span>
                      <span className="font-mono text-[11px] text-core">{h.fit_score ?? "–"}</span>
                      <span className="font-mono text-[11px] text-data">{h.ats_score ?? "–"}%</span>
                    </Link>
                    <button onClick={() => remove(h.id)} aria-label="Delete analysis" className="p-1 text-faint opacity-0 hover:text-alert group-hover:opacity-100">
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Result */}
        {!a ? (
          busy ? (
            <Holo title="Analysing" tone="core">
              <div className="flex items-center gap-3 p-6 text-sm text-soft">
                <Loader2 size={16} className="animate-spin text-core" /> Reading your resume, projects and experience, then scoring the match. Usually under 10 seconds.
              </div>
            </Holo>
          ) : (
            <Empty>Paste a job description to see your fit score, ATS keyword match, tailored summary, resume bullets, cover letter and interview prep.</Empty>
          )
        ) : (
          <div id="career-result" className="min-w-0 scroll-mt-16 space-y-4">
            <Holo title={`${a.role}${a.company ? ` @ ${a.company}` : ""}`} right={<CopyButton text={toMarkdown(a)} label="Copy all" />} tone="core">
              <div className="flex flex-wrap items-center gap-6 p-5">
                <div className="flex gap-4">
                  <div className="scale-125">
                    <Gauge label="FIT" value={Math.round(a.fit_score)} max={100} tone="core" />
                  </div>
                  <div className="scale-125">
                    <Gauge label="ATS %" value={a.ats_score} max={100} />
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] leading-relaxed">{a.verdict}</p>
                  {result?.created_at && <p className="mt-1 font-mono text-[10px] text-faint">{fmtDate(result.created_at)}{result.model ? ` · ${result.model}` : ""}</p>}
                </div>
              </div>
              <div className="grid gap-4 border-t border-data/15 p-5 sm:grid-cols-2">
                <div>
                  <div className="hud-label mb-2 text-ok">You have ({a.matched_keywords.length})</div>
                  <div className="flex flex-wrap gap-1">
                    {a.matched_keywords.map((k) => (
                      <Badge key={k} tone="ok">
                        {k}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="hud-label mb-2 text-alert">Missing ({a.missing_keywords.length})</div>
                  <div className="flex flex-wrap gap-1">
                    {a.missing_keywords.map((k) => (
                      <span key={k} className="rounded-sm bg-alert/10 px-1.5 py-0.5 font-mono text-[10.5px] uppercase tracking-wider text-alert">
                        {k}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </Holo>

            {result && <TailoredResume key={result.id} analysisId={result.id} />}

            <Holo title="Tailored resume summary" right={<CopyButton text={a.tailored_summary} />}>
              <p className="p-5 text-[14.5px] leading-relaxed">{a.tailored_summary}</p>
            </Holo>

            <div className="grid gap-4 xl:grid-cols-2">
              <Holo title="Strengths">
                <ul className="space-y-3 p-5">
                  {a.strengths.map((s, i) => (
                    <li key={i} className="text-[13.5px]">
                      <div className="font-medium">{s.point}</div>
                      {s.evidence && <div className="mt-0.5 text-[12.5px] text-soft">{s.evidence}</div>}
                    </li>
                  ))}
                </ul>
              </Holo>
              <Holo title="Gaps & how to close them">
                <ul className="space-y-3 p-5">
                  {a.gaps.map((g, i) => (
                    <li key={i} className="text-[13.5px]">
                      <div className="font-medium text-alert/90">{g.gap}</div>
                      {g.how_to_close && <div className="mt-0.5 text-[12.5px] text-soft">{g.how_to_close}</div>}
                    </li>
                  ))}
                </ul>
              </Holo>
            </div>

            <Holo
              title="Best-matching projects · tailored bullets"
              right={<CopyButton text={a.best_projects.map((p) => `${p.name}\n${p.bullets.map((b) => `• ${b}`).join("\n")}`).join("\n\n")} />}
            >
              <div className="divide-y divide-data/10">
                {a.best_projects.map((p) => (
                  <div key={p.name} className="p-5">
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="font-medium">{p.name}</div>
                      <CopyButton text={p.bullets.map((b) => `• ${b}`).join("\n")} />
                    </div>
                    {p.why && <p className="mt-0.5 text-[12.5px] text-soft">{p.why}</p>}
                    <ul className="mt-2 space-y-1.5">
                      {p.bullets.map((b, i) => (
                        <li key={i} className="flex gap-2 text-[13.5px]">
                          <span className="mt-[0.55em] h-1 w-1 shrink-0 bg-core" />
                          {b}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </Holo>

            <Holo title="Cover letter" right={<CopyButton text={a.cover_letter} />}>
              <p className="whitespace-pre-wrap p-5 text-[14px] leading-relaxed">{a.cover_letter}</p>
            </Holo>

            <div className="grid gap-4 xl:grid-cols-2">
              <Holo title="Likely interview questions">
                <ol className="space-y-3 p-5">
                  {a.interview_questions.map((q, i) => (
                    <li key={i} className="text-[13.5px]">
                      <div className="flex gap-2 font-medium">
                        <span className="font-mono text-[11px] text-core">{String(i + 1).padStart(2, "0")}</span>
                        {q.q}
                      </div>
                      {q.hint && <div className="ml-7 mt-0.5 text-[12.5px] text-soft">{q.hint}</div>}
                    </li>
                  ))}
                </ol>
              </Holo>
              <Holo title="Learning plan">
                <ul className="space-y-3 p-5">
                  {a.learning_plan.map((l, i) => (
                    <li key={i} className="text-[13.5px]">
                      <div className="font-medium text-data">{l.skill}</div>
                      {l.action && <div className="mt-0.5 text-[12.5px] text-soft">{l.action}</div>}
                    </li>
                  ))}
                </ul>
              </Holo>
            </div>

            {a.evidence.length > 0 && (
              <div>
                <div className="hud-label mb-2">Evidence used from your brain</div>
                <div className="flex flex-wrap gap-1.5">
                  {a.evidence.map((e, i) => (
                    <Link key={i} href={e.href} className="max-w-72 truncate border border-data/25 px-2 py-1 font-mono text-[10.5px] text-soft hover:border-data hover:text-data">
                      {e.type} · {e.title}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
