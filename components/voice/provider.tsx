"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { BRAIN_CHANGED, WEB_TASK_EVENT } from "@/lib/client-api";
import { type MusicCommand, musicCommand } from "@/components/music/player";
import { type VideoCommand, videoCommand } from "@/components/video/player";
import { isPublicPage } from "@/lib/public-paths";
import { LiveVoice, type LiveSource, type LiveState } from "@/lib/live";
import { openExternal } from "@/lib/open-link";
import { click, listControls, scroll, selectOption, typeText } from "./dom-tools";

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
export type VoiceAction = {
  description: string;
  run: (args: ToolResult) => Promise<ToolResult> | ToolResult;
};

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
  /** An app update for the voice to pass on (not the owner speaking). False when voice is off. */
  note: (text: string) => boolean;
  level: () => number;
  subscribe: (l: VoiceListener) => () => void;
  register: (name: string, action: () => VoiceAction) => () => void;
  /** Call / message buttons voice prepared: the owner taps one (browsers never dial or send by themselves). */
  handoff: Handoff[];
  clearHandoff: () => void;
};
export type Handoff = { label: string; href: string };

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
    const offs = names
      .split("|")
      .filter(Boolean)
      .map((n) => register(n, () => ref.current[n]));
    return () => offs.forEach((off) => off());
  }, [names, register]);
}

async function call(url: string, method = "POST", body?: object): Promise<ToolResult> {
  const r = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
  return j as ToolResult;
}

type AnalysisOut = {
  id: string;
  analysis: {
    role: string;
    company: string;
    fit_score: number;
    ats_score: number;
    verdict: string;
    missing_keywords: string[];
  };
};
type TailoredOut = {
  keywords_added: string[];
  not_added: string[];
  changes: string[];
};

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

type AgentToolOut = {
  result: Record<string, unknown>;
  sources: LiveSource[];
  actions: { label: string; href?: string; navigate?: boolean; open?: boolean }[];
  changed: boolean;
  jobs: Record<string, unknown>[] | null;
  pending_delete: { id: string; title: string } | null;
};
/** Server tools whose result page should open right away (the owner asked to go there or to see the result). */
const OPENS_PAGE = new Set(["open_source", "check_listed_job"]);

/** Spoken phrases that end the live session even if the model forgets to call go_to_sleep. */
const SLEEP_WORDS = {
  test: (q: string) =>
    /\b(go(ing)? to sleep|sleep now|stop listening|turn off (the )?mic|mic off)\b/i.test(q) ||
    // A bare goodbye ("bye", "okay goodnight Hivemind"), not one inside a sentence.
    /^\W*(ok(ay)?\W+)?(good ?night|bye[ -]?bye|goodbye|bye)(\W+(hivemind|for now|then))?\W*$/i.test(q.trim()),
};

const PAGES = ["/", "/projects", "/memories", "/career", "/journey", "/habits", "/notes", "/documents", "/sources", "/search", "/settings", "/autopilot", "/web"];

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
  const [handoff, setHandoff] = useState<Handoff[]>([]);
  const clearHandoff = useCallback(() => setHandoff([]), []);
  const listeners = useRef(new Set<VoiceListener>());
  const liveRef = useRef<LiveVoice | null>(null);
  const convId = useRef<string | null>(null);
  const turn = useRef<{
    q: string;
    a: string;
    sources: LiveSource[];
    open: boolean;
  }>({ q: "", a: "", sources: [], open: false });
  const actions = useRef(new Map<string, () => VoiceAction>());
  // Live-voice memory across turns: the last job search, and a memory awaiting "yes, delete it".
  const agentState = useRef<{
    jobs?: Record<string, unknown>[];
    pending?: { id: string; title: string; turn: number };
  }>({});
  const turns = useRef(0);
  const lastSources = useRef<LiveSource[]>([]);
  const sleepAfterTurn = useRef(false);
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
        turns.current++;
        if (t.sources.length) lastSources.current = t.sources;
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
            body: JSON.stringify({
              conversation_id: convId.current,
              user: t.q,
              assistant: a,
              sources: t.sources,
            }),
          })
            .then((r) => r.json())
            .then((j: { conversation_id?: string }) => {
              if (j.conversation_id) convId.current = j.conversation_id;
            })
            .catch(() => {});
        }
        // "Go to sleep": turn the mic off once the goodbye has finished playing.
        if (sleepAfterTurn.current || SLEEP_WORDS.test(t.q)) {
          sleepAfterTurn.current = false;
          const live = liveRef.current;
          setTimeout(() => live?.stop(), (live?.remainingAudio ?? 0) * 1000 + 400);
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
      serverTool: async (name, args) => {
        const st = agentState.current;
        // Approving a browser step needs the owner's own words this turn, never an app update or page text.
        if (name === "web_task_answer" && args.decision === "approve" && !/\b(approve[ds]?|yes|yeah|yep|go ahead|do it|submit|confirm|ok(ay)?|sure|proceed|haan|seri|sari)\b/i.test(turn.current.q)) {
          return { error: "Only the owner can approve. Tell them the step and ask 'Should I approve it?', then wait for their answer." };
        }
        // A delete only goes through after the owner spoke again since it was proposed.
        const pending = st.pending && turns.current > st.pending.turn ? { id: st.pending.id, title: st.pending.title } : null;
        if (name === "confirm_delete_memory" && st.pending && !pending)
          return {
            error: "Ask the owner to confirm first and wait for their answer.",
          };
        // "Take me there" with nothing else: use what the last answer was based on.
        // "Delete this analysis" on the Career page means the one open on screen.
        const openId = new URLSearchParams(location.search).get("open");
        const vague = !/[a-z]{4,}/i.test(String(args.which ?? "").replace(/\b(this|that|current|open|one|analysis|job|delete)\b/gi, ""));
        if (name === "delete_job_analysis" && !args.id && openId && location.pathname.startsWith("/career") && vague) args = { ...args, id: openId };
        if (name === "open_source" && !args.about && !turn.current.sources.length && lastSources.current[0]) args = { ...args, about: lastSources.current[0].title };
        const r = (await call("/api/agent-tool", "POST", {
          name,
          args,
          state: { jobs: st.jobs, pending_delete: pending },
        })) as unknown as AgentToolOut;
        if (r.jobs) st.jobs = r.jobs;
        // The floating browser window picks up a new / answered web task at once.
        if (name.startsWith("web_task")) window.dispatchEvent(new Event(WEB_TASK_EVENT));
        if (name === "confirm_delete_memory") {
          st.pending = undefined;
          // Don't leave the page showing something that no longer exists.
          if (r.result.deleted && openId && r.result.id === openId) routerRef.current.push(location.pathname);
        }
        if (r.pending_delete) st.pending = { ...r.pending_delete, turn: turns.current };
        if (r.sources.length) {
          turn.current.sources = r.sources;
          each((l) => l.onSources?.(r.sources));
        }
        if (r.changed) {
          each((l) => l.onBrainChanged?.());
          window.dispatchEvent(new Event(BRAIN_CHANGED));
        }
        // Calls, messages and outside links (e.g. product pages) become tap buttons on screen.
        const taps = r.actions.filter((a): a is Handoff => !!a.href && /^(tel:|sms:|https?:\/\/)/.test(a.href));
        if (taps.length) setHandoff(taps);
        const go = r.actions.find((a) => a.href?.startsWith("/") && (a.navigate || OPENS_PAGE.has(name)));
        if (go?.href) routerRef.current.push(go.href);
        // open_link: open it now; when the browser blocks the tab, the tap button above is the fallback.
        const open = r.actions.find((a) => a.open && a.href);
        if (open?.href) {
          const opened = openExternal(open.href);
          if (opened) setHandoff([]);
          return { ...r.result, opened, ...(opened ? {} : { blocked: "The browser blocked the new tab. Ask the owner to tap the green button on screen." }) };
        }
        // Outside links can't be spoken usefully; say where they point instead.
        const links = r.actions.filter((a) => a.href?.startsWith("http")).map((a) => a.label);
        return links.length ? { ...r.result, links_shown_on_screen: links } : r.result;
      },
      clientTools: {
        navigate: ({ page }) => {
          const path = String(page ?? "");
          if (!PAGES.includes(path)) return { error: `unknown page ${path}` };
          routerRef.current.push(path);
          return { opened: path };
        },
        page_actions: () => ({
          page: location.pathname,
          actions: [...actions.current.entries()].map(([name, get]) => ({
            name,
            description: get().description,
          })),
        }),
        do_page_action: async ({ name, input }) => {
          const get = actions.current.get(String(name));
          if (!get)
            return {
              error: `No action "${name}" on this page. Call page_actions to see what's available.`,
            };
          return await get().run({ input: input == null ? "" : String(input) });
        },
        analyze_job: async (args) => {
          const page = actions.current.get("analyse_job");
          if (page) return await page().run(args);
          const jd = String(args.job_description ?? "").trim();
          if (jd.length < 80)
            return {
              error: "I need the job description. Paste it on the Career page, or read it to me.",
            };
          const r = (await call("/api/career", "POST", {
            jobDescription: jd,
            role: args.role || undefined,
            company: args.company || undefined,
          })) as unknown as AnalysisOut;
          routerRef.current.push(`/career?open=${r.id}`);
          return summarizeAnalysis(r);
        },
        tailor_resume: async () => {
          const page = actions.current.get("generate_resume");
          if (page) return await page().run({});
          let id = new URLSearchParams(location.search).get("open");
          if (!location.pathname.startsWith("/career") || !id) {
            const list = (await call("/api/career", "GET")) as unknown as {
              id: string;
            }[];
            id = list[0]?.id ?? null;
          }
          if (!id)
            return {
              error: "There's no job analysis yet. Analyse a job description first.",
            };
          const t = (await call(`/api/career/${id}/resume`)) as unknown as TailoredOut;
          routerRef.current.push(`/career?open=${id}`);
          window.dispatchEvent(new Event(BRAIN_CHANGED));
          return summarizeTailored(t);
        },
        get_weather: async ({ place }) => await call(`/api/tools/weather${place ? `?place=${encodeURIComponent(String(place))}` : ""}`, "GET"),
        web_search: async ({ query, save }) => {
          const r = (await call("/api/tools/web", "POST", {
            query: String(query ?? ""),
            save: !!save,
          })) as {
            answer: string;
            sources: { title: string }[];
            saved?: { id: string; title: string };
          };
          if (r.saved) window.dispatchEvent(new Event(BRAIN_CHANGED));
          return {
            answer: r.answer.slice(0, 3000),
            sources: r.sources.map((x) => x.title),
            saved_as_note: r.saved?.title ?? null,
          };
        },
        create_reminder: async ({ title, date, time, in_minutes, details }) => {
          const r = await call("/api/reminders", "POST", {
            title: String(title ?? ""),
            date: date ? String(date) : undefined,
            time: time ? String(time) : undefined,
            in_minutes: in_minutes ? Number(in_minutes) : undefined,
            details: details ? String(details) : undefined,
          });
          window.dispatchEvent(new Event(BRAIN_CHANGED));
          return { scheduled: true, title: r.title, when: r.when };
        },
        change_reminder: async ({ action, which, date, time, in_minutes }) => {
          const r = await call("/api/reminders/act", "POST", {
            action: String(action),
            which: String(which ?? ""),
            date: date ? String(date) : undefined,
            time: time ? String(time) : undefined,
            in_minutes: in_minutes ? Number(in_minutes) : undefined,
          });
          if (!r.error) window.dispatchEvent(new Event(BRAIN_CHANGED));
          return r;
        },
        list_reminders: async () => {
          const a = (await call("/api/reminders?days=7", "GET")) as Record<string, { title: string; when: string; status: string }[]>;
          const pick = (k: string) => (a[k] ?? []).map((r) => `${r.title} (${r.when}${r.status === "done" ? ", done" : ""})`);
          return {
            overdue: pick("overdue"),
            today: pick("today"),
            tomorrow: pick("tomorrow"),
            later: pick("later"),
          };
        },
        create_note: async ({ title, content }) => {
          const n = await call("/api/notes", "POST", {
            title: title ? String(title) : undefined,
            content: String(content ?? ""),
          });
          window.dispatchEvent(new Event(BRAIN_CHANGED));
          return { saved: true, title: n.title };
        },
        read_screen: () => {
          const root = document.querySelector("main") ?? document.body;
          const text = (root as HTMLElement).innerText.replace(/\n{3,}/g, "\n\n").trim();
          // innerText skips what's typed/pasted into form fields, so report those separately.
          const fields = [...root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("textarea, input:not([type=hidden]):not([type=password])")]
            .filter((f) => f.value.trim())
            .map((f) => ({
              field: f.getAttribute("aria-label") || f.placeholder || f.name || f.tagName.toLowerCase(),
              value: f.value.slice(0, 6000),
            }));
          return {
            page: location.pathname + location.search,
            form_fields: fields,
            controls: listControls(),
            text: text.slice(0, 6000) || "(the page is empty)",
          };
        },
        // Use the page like a person: scroll, click, type, choose, go back.
        click,
        scroll,
        type_text: typeText,
        select_option: selectOption,
        music: (args) => musicCommand(args as MusicCommand),
        video: (args) => videoCommand(args as VideoCommand),
        go_to_sleep: () => {
          sleepAfterTurn.current = true;
          return { sleeping: true, note: "Say a very short goodbye; the mic turns off when you finish." };
        },
        go_back: () => {
          history.back();
          return { went: "back" };
        },
        go_forward: () => {
          history.forward();
          return { went: "forward" };
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
  // App updates (a web task needs approval / finished). A fresh turn with no owner words, so nothing
  // in the update (it can quote web pages) ever counts as the owner saying "approve".
  const note = useCallback((text: string) => {
    const live = liveRef.current;
    if (!live?.active) return false;
    turn.current = { q: "", a: "", sources: [], open: true };
    live.sendText(text);
    return true;
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
    if (isPublicPage(pathname)) return;
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
    () => ({
      state,
      on: state !== "off",
      error,
      last,
      start,
      stop,
      toggle,
      sendText,
      note,
      level,
      subscribe,
      register,
      handoff,
      clearHandoff,
    }),
    [state, error, last, start, stop, toggle, sendText, note, level, subscribe, register, handoff, clearHandoff],
  );
  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}
