"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { BRAIN_CHANGED } from "@/lib/client-api";
import { LiveVoice, type LiveSource, type LiveState } from "@/lib/live";

/** Everything a page can react to during a live conversation. */
export type VoiceListener = {
  onUserText?: (text: string) => void;
  onModelText?: (delta: string) => void;
  onTurnEnd?: (interrupted: boolean) => void;
  onSources?: (sources: LiveSource[]) => void;
  onBrainChanged?: () => void;
};

type ToolResult = Record<string, unknown>;
/** Something the current page can do when asked by voice (clicking its own buttons, filling its forms). */
export type VoiceAction = { description: string; run: (args: ToolResult) => Promise<ToolResult> | ToolResult };

export type Exchange = { q: string; a: string; done: boolean };

type Voice = {
  state: LiveState;
  on: boolean;
  error: string | null;
  /** The latest spoken exchange, for compact displays. */
  last: Exchange | null;
  start: () => void;
  stop: () => void;
  toggle: () => void;
  sendText: (text: string) => void;
  level: () => number;
  subscribe: (l: VoiceListener) => () => void;
  register: (name: string, action: () => VoiceAction) => () => void;
};

const VoiceContext = createContext<Voice | null>(null);

export function useVoice() {
  const v = useContext(VoiceContext);
  if (!v) throw new Error("useVoice must be used inside <VoiceProvider>");
  return v;
}


/**
 * Lets a page expose its own actions to voice while it's mounted. Actions always run with the page's
 * latest state (they're read through a ref at call time).
 */
export function useVoiceActions(actions: Record<string, VoiceAction>) {
  const { register } = useVoice();
  const ref = useRef(actions);
  useEffect(() => {
    ref.current = actions;
  });
  const names = Object.keys(actions).join("|");
  useEffect(() => {
    const offs = names.split("|").filter(Boolean).map((n) => register(n, () => ref.current[n]));
    return () => offs.forEach((off) => off());
  }, [names, register]);
}

async function call(url: string, method = "POST", body?: object): Promise<ToolResult> {
  const r = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
  return j as ToolResult;
}

type AnalysisOut = { id: string; analysis: { role: string; company: string; fit_score: number; ats_score: number; verdict: string; missing_keywords: string[] } };
type TailoredOut = { keywords_added: string[]; not_added: string[]; changes: string[] };

/** Short, speakable summaries the model reports back (never the whole payload). */
export const summarizeAnalysis = (r: AnalysisOut) => ({
  done: true,
  analysis_id: r.id,
  role: r.analysis.role,
  company: r.analysis.company,
  fit_score: r.analysis.fit_score,
  ats_percent: r.analysis.ats_score,
  verdict: r.analysis.verdict,
  missing_keywords: r.analysis.missing_keywords,
});
export const summarizeTailored = (t: TailoredOut) => ({
  done: true,
  keywords_added: t.keywords_added,
  left_out_no_evidence: t.not_added,
  changes: t.changes.slice(0, 8),
  note: "The PDF is shown on the Career page with View / Download buttons.",
});

const PAGES = ["/", "/projects", "/memories", "/career", "/notes", "/documents", "/sources", "/search", "/settings"];

/**
 * One Gemini Live session for the whole site. It lives in the root layout, so the conversation keeps
 * going while the owner moves between pages, and voice can open pages and read what's on screen.
 */
export function VoiceProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<LiveState>("off");
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<Exchange | null>(null);
  const listeners = useRef(new Set<VoiceListener>());
  const liveRef = useRef<LiveVoice | null>(null);
  const convId = useRef<string | null>(null);
  const turn = useRef<{ q: string; a: string; sources: LiveSource[]; open: boolean }>({ q: "", a: "", sources: [], open: false });
  const actions = useRef(new Map<string, () => VoiceAction>());
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  const getLive = useCallback(() => {
    if (liveRef.current) return liveRef.current;
    const each = (fn: (l: VoiceListener) => void) => listeners.current.forEach(fn);
    const open = () => {
      if (!turn.current.open) turn.current = { q: "", a: "", sources: [], open: true };
    };
    liveRef.current = new LiveVoice({
      onState: setState,
      onUserText: (text) => {
        open();
        if (!turn.current.a) turn.current.q = text;
        setLast({ q: turn.current.q, a: turn.current.a, done: false });
        each((l) => l.onUserText?.(text));
      },
      onModelText: (delta) => {
        open();
        turn.current.a += delta;
        setLast({ q: turn.current.q, a: turn.current.a, done: false });
        each((l) => l.onModelText?.(delta));
      },
      onTurnEnd: (interrupted) => {
        const t = turn.current;
        each((l) => l.onTurnEnd?.(interrupted));
        if (!t.open) return;
        t.open = false;
        const a = interrupted && t.a ? `${t.a.trim()} …` : t.a;
        setLast({ q: t.q, a, done: true });
        // Keep every spoken exchange in chat history, whichever page it happened on.
        if (t.q || a) {
          void fetch("/api/live/log", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ conversation_id: convId.current, user: t.q, assistant: a, sources: t.sources }),
          })
            .then((r) => r.json())
            .then((j: { conversation_id?: string }) => {
              if (j.conversation_id) convId.current = j.conversation_id;
            })
            .catch(() => {});
        }
      },
      onSources: (sources) => {
        turn.current.sources = sources;
        each((l) => l.onSources?.(sources));
      },
      onBrainChanged: () => {
        each((l) => l.onBrainChanged?.());
        window.dispatchEvent(new Event(BRAIN_CHANGED));
      },
      onError: setError,
      clientTools: {
        navigate: ({ page }) => {
          const path = String(page ?? "");
          if (!PAGES.includes(path)) return { error: `unknown page ${path}` };
          routerRef.current.push(path);
          return { opened: path };
        },
        page_actions: () => ({
          page: location.pathname,
          actions: [...actions.current.entries()].map(([name, get]) => ({ name, description: get().description })),
        }),
        do_page_action: async ({ name, input }) => {
          const get = actions.current.get(String(name));
          if (!get) return { error: `No action "${name}" on this page. Call page_actions to see what's available.` };
          return await get().run({ input: input == null ? "" : String(input) });
        },
        analyze_job: async (args) => {
          const page = actions.current.get("analyse_job");
          if (page) return await page().run(args);
          const jd = String(args.job_description ?? "").trim();
          if (jd.length < 80) return { error: "I need the job description. Paste it on the Career page, or read it to me." };
          const r = (await call("/api/career", "POST", { jobDescription: jd, role: args.role || undefined, company: args.company || undefined })) as unknown as AnalysisOut;
          routerRef.current.push(`/career?open=${r.id}`);
          return summarizeAnalysis(r);
        },
        tailor_resume: async () => {
          const page = actions.current.get("generate_resume");
          if (page) return await page().run({});
          let id = new URLSearchParams(location.search).get("open");
          if (!location.pathname.startsWith("/career") || !id) {
            const list = (await call("/api/career", "GET")) as unknown as { id: string }[];
            id = list[0]?.id ?? null;
          }
          if (!id) return { error: "There's no job analysis yet. Analyse a job description first." };
          const t = (await call(`/api/career/${id}/resume`)) as unknown as TailoredOut;
          routerRef.current.push(`/career?open=${id}`);
          window.dispatchEvent(new Event(BRAIN_CHANGED));
          return summarizeTailored(t);
        },
        create_note: async ({ title, content }) => {
          const n = await call("/api/notes", "POST", { title: title ? String(title) : undefined, content: String(content ?? "") });
          window.dispatchEvent(new Event(BRAIN_CHANGED));
          return { saved: true, title: n.title };
        },
        read_screen: () => {
          const root = document.querySelector("main") ?? document.body;
          const text = (root as HTMLElement).innerText.replace(/\n{3,}/g, "\n\n").trim();
          // innerText skips what's typed/pasted into form fields, so report those separately.
          const fields = [...root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("textarea, input:not([type=hidden]):not([type=password])")]
            .filter((f) => f.value.trim())
            .map((f) => ({ field: f.getAttribute("aria-label") || f.placeholder || f.name || f.tagName.toLowerCase(), value: f.value.slice(0, 6000) }));
          return { page: location.pathname + location.search, form_fields: fields, text: text.slice(0, 6000) || "(the page is empty)" };
        },
      },
    });
    return liveRef.current;
  }, []);

  const start = useCallback(() => {
    const live = getLive();
    if (live.active) return;
    setError(null);
    setLast(null);
    convId.current = null;
    void live.start();
  }, [getLive]);
  const stop = useCallback(() => liveRef.current?.stop(), []);
  const toggle = useCallback(() => (liveRef.current?.active ? stop() : start()), [start, stop]);
  const sendText = useCallback((text: string) => {
    const live = liveRef.current;
    if (!live?.active) return;
    turn.current = { q: text, a: "", sources: [], open: true };
    setLast({ q: text, a: "", done: false });
    live.sendText(text);
  }, []);
  const level = useCallback(() => liveRef.current?.level() ?? 0, []);
  const register = useCallback((name: string, action: () => VoiceAction) => {
    actions.current.set(name, action);
    return () => {
      if (actions.current.get(name) === action) actions.current.delete(name);
    };
  }, []);
  const subscribe = useCallback((l: VoiceListener) => {
    listeners.current.add(l);
    return () => void listeners.current.delete(l);
  }, []);

  // Space (outside text fields and buttons) starts / ends the conversation on every page.
  useEffect(() => {
    if (pathname.startsWith("/unlock")) return;
    const down = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const busy = el && (["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(el.tagName) || el.isContentEditable);
      if (e.code === "Space" && !busy && !e.repeat) {
        e.preventDefault();
        toggle();
      } else if (e.key === "Escape") stop();
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [toggle, stop, pathname]);

  useEffect(() => () => liveRef.current?.stop(), []);

  const value = useMemo<Voice>(
    () => ({ state, on: state !== "off", error, last, start, stop, toggle, sendText, level, subscribe, register }),
    [state, error, last, start, stop, toggle, sendText, level, subscribe, register],
  );
  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}
