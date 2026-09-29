"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ArrowUp, Crosshair, Plus, RefreshCw, Undo2, Volume2, VolumeX, Wand2, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Boot } from "@/components/bridge/boot";
import { Compass } from "@/components/bridge/compass";
import { Cursor } from "@/components/bridge/cursor";
import { Gauge, Holo, Meter } from "@/components/bridge/holo";
import { Scramble } from "@/components/bridge/scramble";
import type { CoreState } from "@/components/core";
import { Decrypt } from "@/components/fx";
import { Galaxy, type GNode, type GProject } from "@/components/galaxy/galaxy";
import type { GalaxyScene, Telemetry } from "@/components/galaxy/scene";
import { cx, RichText } from "@/components/ui";
import { api, type Brain as BrainT, type HiveEvent, type Source, streamHivemind, useFetch } from "@/lib/client-api";
import { isMuted, setMuted, sfx } from "@/lib/sfx";

gsap.registerPlugin(useGSAP);

type Turn = {
  q: string;
  a: string;
  intent?: string;
  sources?: Source[];
  actions?: { label: string; href?: string }[];
  model?: string;
  latency?: number;
  streaming: boolean;
  error?: boolean;
};
type GalaxyData = { nodes: GNode[]; projects: GProject[] };
type MobileTab = "console" | "operator" | "log";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/projects", label: "Projects" },
  { href: "/memories", label: "Memories" },
  { href: "/notes", label: "Notes" },
  { href: "/documents", label: "Documents" },
  { href: "/sources", label: "Sources" },
  { href: "/search", label: "Search" },
  { href: "/settings", label: "Settings" },
];
const KIND_DOT: Record<string, string> = { memory: "bg-data", note: "bg-ok", document: "bg-[#b59cff]" };
const INTENT: Record<string, string> = { SEARCH: "RECALL", STORE_MEMORY: "STORED", UPDATE_MEMORY: "UPDATE", CREATE_PROJECT: "NEW SECTOR", GENERAL_CHAT: "COMMS" };
const idFromHref = (href: string) => href.split("open=")[1] ?? "";

export default function BridgePage() {
  return (
    <Suspense>
      <Bridge />
    </Suspense>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function Bridge() {
  const params = useSearchParams();
  const brain = useFetch<BrainT>("/api/brain");
  const galaxy = useFetch<GalaxyData>("/api/galaxy");
  const sceneRef = useRef<GalaxyScene | null>(null);
  const [sceneReady, setSceneReady] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const [state, setState] = useState<CoreState>("idle");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [focus, setFocus] = useState<GProject | null>(null);
  const [hover, setHover] = useState<{ node: GNode; x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<GNode | null>(null);
  const [booted, setBooted] = useState(false);
  const [tab, setTab] = useState<MobileTab>("console");
  const [muted, setMutedState] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [clock, setClock] = useState("");
  const [tele, setTele] = useState<Telemetry | null>(null);

  // Entrance once the boot log hands over: bar drops, columns slide in from their edges, stage fades up.
  useGSAP(
    () => {
      if (!booted || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      gsap
        .timeline({ defaults: { ease: "expo.out", duration: 0.9 } })
        .from(".in-top", { y: -24, autoAlpha: 0, duration: 0.6 })
        .from(".in-stage", { autoAlpha: 0, scale: 0.985, duration: 1.2 }, 0.05)
        .from(".in-left > *", { x: -32, autoAlpha: 0, stagger: 0.08 }, 0.15)
        .from(".in-right", { x: 32, autoAlpha: 0 }, 0.2);
    },
    { dependencies: [booted], scope: rootRef },
  );

  useEffect(() => {
     
    setMutedState(isMuted());
    const tick = () => setClock(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    const tid = setInterval(() => setTele(sceneRef.current?.telemetry() ?? null), 500);
    return () => {
      clearInterval(id);
      clearInterval(tid);
    };
  }, []);

  useEffect(() => {
    if (sceneReady && galaxy.data) sceneRef.current?.setData(galaxy.data.nodes, galaxy.data.projects);
  }, [sceneReady, galaxy.data]);

  useEffect(() => {
    sceneRef.current?.setState(state);
  }, [state]);

  useEffect(() => {
    sceneRef.current?.setSelected(selected?.id ?? null);
  }, [selected]);

  useEffect(() => {
    const pid = params.get("project");
    if (pid && sceneReady && galaxy.data) {
      const p = galaxy.data.projects.find((x) => x.id === pid);
      if (p) {
         
        setFocus(p);
        sceneRef.current?.focusProject(p.id);
      }
    }
  }, [params, sceneReady, galaxy.data]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: "end" });
  }, [turns]);

  const readTelemetry = useCallback(() => sceneRef.current?.telemetry() ?? null, []);

  const focusProject = useCallback((p: GProject | null) => {
    setFocus(p);
    setSelected(null);
    sceneRef.current?.focusProject(p?.id ?? null);
    if (p) sfx.lock();
  }, []);

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || state !== "idle") return;
      setInput("");
      setSelected(null);
      setTab("console");
      setState("thinking");
      sfx.send();
      setTurns((t) => [...t, { q: message, a: "", streaming: true }]);
      const patch = (fn: (t: Turn) => Turn) => setTurns((all) => [...all.slice(0, -1), fn(all[all.length - 1])]);
      let changed = false;
      try {
        await streamHivemind({ message, conversation_id: conversationId, project_id: focus?.id ?? null }, (e: HiveEvent) => {
          if (e.type === "meta") {
            setConversationId(e.conversation_id);
            changed = ["STORE_MEMORY", "CREATE_PROJECT"].includes(e.intent);
            patch((t) => ({ ...t, intent: e.intent, sources: e.sources }));
            const ids = e.sources.map((s) => idFromHref(s.href)).filter(Boolean);
            if (ids.length) {
              sceneRef.current?.highlight(ids);
              ids.slice(0, 6).forEach((_, i) => setTimeout(() => sfx.lock(), 120 + i * 90));
            }
          } else if (e.type === "delta") {
            setState("answering");
            patch((t) => ({ ...t, a: t.a + e.text }));
          } else if (e.type === "action") {
            patch((t) => ({ ...t, actions: [...(t.actions ?? []), { label: e.label, href: e.href }] }));
          } else if (e.type === "done") {
            patch((t) => ({ ...t, model: e.model, latency: e.latency_ms }));
            sfx.done();
          } else if (e.type === "error") {
            patch((t) => ({ ...t, error: true, a: t.a || e.message }));
            sfx.error();
          }
        });
      } catch (err) {
        patch((t) => ({ ...t, error: true, a: err instanceof Error ? err.message : "Something went wrong." }));
        sfx.error();
      } finally {
        patch((t) => ({ ...t, streaming: false }));
        setState("idle");
        if (changed) {
          brain.reload();
          galaxy.reload();
        }
        inputRef.current?.focus();
      }
    },
    [state, conversationId, focus, brain, galaxy],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA";
      if (e.key === "/" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.key === "Escape") {
        setSelected(null);
        focusProject(null);
        sceneRef.current?.clearHighlight();
        (e.target as HTMLElement)?.blur?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusProject]);

  async function brainAction(key: string, body: object) {
    setBusyAction(key);
    try {
      await api("/api/brain", { method: "POST", json: body });
      brain.reload();
      galaxy.reload();
    } finally {
      setBusyAction(null);
    }
  }

  function newSession() {
    setTurns([]);
    setConversationId(null);
    sceneRef.current?.clearHighlight();
    inputRef.current?.focus();
  }

  const b = brain.data;
  const composition = useMemo(() => {
    const c = new Map<string, number>();
    for (const n of galaxy.data?.nodes ?? []) {
      const k = n.kind === "memory" ? (n.subtype ?? "memory").replace("_", " ") : n.kind;
      c.set(k, (c.get(k) ?? 0) + 1);
    }
    return [...c.entries()].sort((a, z) => z[1] - a[1]).slice(0, 6);
  }, [galaxy.data]);
  const maxCount = b ? Math.max(b.counts.memories, b.counts.notes, b.counts.documents, b.counts.projects, 1) : 1;
  const bootLines = [
    "HIVEMIND OS // cold start",
    "Mounting neural lattice",
    `Indexing ${galaxy.data?.nodes.length ?? "…"} knowledge nodes`,
    `Mapping ${galaxy.data?.projects.length ?? "…"} project constellations`,
    `Loading operator profile${b?.profile ? `: ${b.profile.name.toUpperCase()}` : ""}`,
    "ALL SYSTEMS ONLINE",
  ];
  const statusText = state === "thinking" ? "SCANNING LATTICE" : state === "answering" ? "TRANSMITTING" : focus ? `SECTOR · ${focus.name.toUpperCase()}` : "STANDING BY";
  const firstName = b?.profile?.name?.split(" ")[0];
  const suggestions = [
    "Brief me on who I am",
    "What have I been working on lately?",
    focus ? `What's the status of ${focus.name}?` : b?.projects[0] ? `Tell me the story of ${b.projects[0].name}` : null,
    "What should I learn next?",
  ].filter((s): s is string => !!s);

  /* ───────────── column contents ───────────── */

  const operator = (
    <>
      <Holo title="Operator" right={<span className="font-mono text-[10px] text-faint">ID-01</span>}>
        <div className="p-4">
          {b?.profile ? (
            <>
              <div className="text-lg font-semibold tracking-tight">
                <Decrypt text={b.profile.name} />
              </div>
              <div className="mt-0.5 text-xs text-core">{b.profile.current_role || b.profile.headline}</div>
              <div className="font-mono text-[10.5px] text-faint">{b.profile.location}</div>
              <p className="mt-3 line-clamp-4 text-[12.5px] leading-relaxed text-soft">{b.profile.summary}</p>
            </>
          ) : (
            <p className="text-[13px] text-soft">
              No operator profile yet.{" "}
              <Link href="/sources" className="text-data hover:underline">
                Sync your portfolio
              </Link>
              .
            </p>
          )}
          {b && (
            <div className="mt-4 grid grid-cols-4 gap-1">
              <Gauge label="MEM" value={b.counts.memories} max={maxCount} tone="core" />
              <Gauge label="NOTES" value={b.counts.notes} max={maxCount} />
              <Gauge label="DOCS" value={b.counts.documents} max={maxCount} />
              <Gauge label="PROJ" value={b.counts.projects} max={maxCount} tone="core" />
            </div>
          )}
        </div>
      </Holo>
      {composition.length > 0 && (
        <Holo title="Composition">
          <div className="space-y-2.5 p-4">
            {composition.map(([k, v]) => (
              <Meter key={k} label={k} value={v} max={composition[0][1]} />
            ))}
          </div>
        </Holo>
      )}
      {b?.profile?.focus_areas.length ? (
        <Holo title="Focus vectors">
          <ul className="space-y-1.5 p-4">
            {b.profile.focus_areas.map((f, i) => (
              <li key={f} className="flex items-center gap-2 text-[12.5px] text-soft">
                <span className="font-mono text-[10px] text-core">{String(i + 1).padStart(2, "0")}</span>
                {f}
              </li>
            ))}
          </ul>
        </Holo>
      ) : null}
    </>
  );

  const activityLog = (
    <Holo
      title="Autonomous log"
      right={
        <button
          onClick={() => brainAction("profile", { action: "rebuild-profile" })}
          disabled={!!busyAction}
          title="Re-read my brain and update my understanding of you"
          className="text-soft hover:text-core disabled:opacity-40"
          aria-label="Refresh understanding"
        >
          <RefreshCw size={12} className={busyAction === "profile" ? "animate-spin" : ""} />
        </button>
      }
    >
      <ol className="space-y-2 p-4 font-mono text-[11px] leading-snug">
        {(b?.activity ?? []).slice(0, 14).map((a) => (
          <li key={a.id} className="flex gap-2">
            <span className="shrink-0 text-faint">{new Date(a.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}</span>
            <span className={cx("min-w-0 flex-1", a.undone ? "text-faint line-through" : "text-soft")}>{a.message}</span>
            {a.undoable && (
              <button onClick={() => brainAction(a.id, { action: "undo", id: a.id })} disabled={!!busyAction} className="shrink-0 text-faint hover:text-core" title="Undo" aria-label={`Undo: ${a.message}`}>
                <Undo2 size={11} />
              </button>
            )}
          </li>
        ))}
        {b && b.activity.length === 0 && <li className="text-faint">No autonomous actions yet.</li>}
      </ol>
    </Holo>
  );

  const consolePanel = (
    <Holo
      title={<Scramble text={turns.length ? `Console · ${INTENT[turns[turns.length - 1]?.intent ?? ""] ?? "LIVE"}` : "Console"} />}
      right={
        <button onClick={newSession} disabled={!turns.length} className="flex items-center gap-1 font-mono text-[10px] tracking-widest text-soft hover:text-core disabled:opacity-30">
          <Plus size={11} /> NEW
        </button>
      }
      className="flex min-h-0 flex-1 flex-col"
      bodyClassName="min-h-0 flex-1"
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {turns.length === 0 ? (
          <div className="flex min-h-full flex-col justify-end">
            <div className="text-xl font-semibold tracking-tight">
              {greeting()}
              {firstName ? `, ${firstName}.` : "."}
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-soft">
              {b ? `${b.counts.memories} memories across ${b.counts.projects} projects are online. Ask anything about your work, or say “remember that…”.` : "Linking to your brain…"}
            </p>
            <div className="mt-5 space-y-1.5">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="group flex w-full items-center gap-2 border border-line bg-sunken/60 px-3 py-2 text-left text-[13px] text-soft transition-colors hover:border-core/60 hover:text-fg"
                >
                  <span className="font-mono text-[10px] text-data group-hover:text-core">▸</span>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {turns.map((t, i) => (
              <div key={i} className="rise-in">
                <div className="mb-2 flex gap-2 font-mono text-[11.5px]">
                  <span className="text-core">▸</span>
                  <span className="text-fg/85">{t.q}</span>
                </div>
                {t.streaming && !t.a ? (
                  <div className="font-mono text-[12px] text-data">
                    {t.sources?.length ? `LOCKED ${t.sources.length} NODES · SYNTHESIZING` : "SCANNING NEURAL LATTICE"}
                    <span className="stream-caret" aria-hidden />
                  </div>
                ) : (
                  <div className={cx("text-[14px]", t.error ? "text-alert" : "text-fg/90")}>
                    <RichText text={t.a} sources={t.sources} caret={t.streaming} />
                  </div>
                )}
                {t.actions?.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {t.actions.map((a) =>
                      a.href ? (
                        <Link key={a.label} href={a.href} className="border border-data/40 px-2 py-0.5 font-mono text-[10.5px] text-data hover:border-data">
                          {a.label} →
                        </Link>
                      ) : null,
                    )}
                  </div>
                ) : null}
                {!t.streaming && t.sources && t.sources.length > 0 && (
                  <div className="stagger mt-3 flex flex-wrap gap-1.5">
                    {t.sources.map((s) => (
                      <Link key={s.n} href={s.href} title={s.title} className="flex max-w-52 items-center gap-1.5 border border-data/25 px-1.5 py-0.5 font-mono text-[10px] text-soft hover:border-data hover:text-data">
                        <span className="text-data">{s.n}</span>
                        <span className="truncate">{s.title}</span>
                      </Link>
                    ))}
                  </div>
                )}
                {!t.streaming && t.model && (
                  <div className="mt-2 font-mono text-[9.5px] tracking-widest text-faint">
                    {t.model.toUpperCase()}
                    {t.latency ? ` · ${(t.latency / 1000).toFixed(1)}S` : ""}
                  </div>
                )}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="border-t border-data/15 p-3"
      >
        {focus && (
          <button
            type="button"
            onClick={() => focusProject(null)}
            className="mb-2 flex items-center gap-1 bg-core/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-core"
            title="Clear project scope"
          >
            Scope: {focus.name} <X size={10} />
          </button>
        )}
        <div className={cx("flex items-center gap-2 border bg-sunken/80 px-3 py-1.5 transition-colors", state !== "idle" ? "border-core/60" : "border-line focus-within:border-data")}>
          <span className={cx("font-mono text-sm", state !== "idle" ? "animate-pulse text-core" : "text-data")}>▸</span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={state === "idle" ? "Speak to HIVEMIND…" : "Processing…"}
            aria-label="Message HIVEMIND"
            disabled={state !== "idle"}
            className="min-w-0 flex-1 bg-transparent py-1.5 text-[14px] text-fg outline-none placeholder:text-faint"
          />
          <button type="submit" disabled={state !== "idle" || !input.trim()} aria-label="Send" className="flex h-8 w-8 shrink-0 items-center justify-center bg-core text-core-ink transition-opacity disabled:opacity-25">
            <ArrowUp size={16} strokeWidth={2.4} />
          </button>
        </div>
        <div className="mt-1.5 hidden font-mono text-[9.5px] tracking-widest text-faint lg:block">/ TO FOCUS · ESC RESETS VIEW</div>
      </form>
    </Holo>
  );

  return (
    <div ref={rootRef} className="bridge fixed inset-0 flex flex-col bg-bg text-fg">
      <Cursor locked={!!hover} label={hover ? `${hover.node.kind.slice(0, 3).toUpperCase()} · LOCK` : undefined} />
      <Boot onDone={() => setBooted(true)} lines={bootLines} ready={!!galaxy.data && !!b} />

      {/* ───── Top bar ───── */}
      <header className="in-top relative z-20 flex h-14 shrink-0 items-center gap-6 border-b border-line bg-sunken/90 px-4 md:px-5">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <span className="relative flex h-2.5 w-2.5">
            <span className={cx("absolute inline-flex h-full w-full rounded-full bg-core opacity-60", state !== "idle" ? "animate-ping" : "motion-safe:animate-pulse")} />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-core" />
          </span>
          <span className="font-mono text-sm font-semibold tracking-[0.32em]">HIVEMIND</span>
        </Link>
        <nav className="no-scrollbar hidden min-w-0 items-center gap-1 overflow-x-auto md:flex" aria-label="Main">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={n.href === "/" ? "page" : undefined}
              className={cx(
                "relative shrink-0 px-2.5 py-1.5 text-[13px] transition-colors",
                n.href === "/" ? "text-fg after:absolute after:inset-x-2.5 after:-bottom-[13px] after:h-px after:bg-core" : "text-soft hover:text-fg",
              )}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-4 font-mono text-[10.5px] tabular-nums tracking-widest text-faint">
          <Scramble className="hidden text-data xl:inline" text={statusText} duration={0.5} />
          {tele && (
            <span className="hidden items-center gap-3 2xl:flex">
              <span className="eq flex items-end" aria-hidden>
                {[0, 1, 2, 3, 4].map((i) => (
                  <span key={i} style={{ animationDelay: `${i * 0.13}s`, animationDuration: state === "idle" ? "2.4s" : "0.6s" }} />
                ))}
              </span>
              <span>FPS <b className="font-normal text-data">{tele.fps}</b></span>
              <span>LOCK <b className={cx("font-normal", tele.locked ? "text-core" : "text-data")}>{String(tele.locked).padStart(2, "0")}</b></span>
            </span>
          )}
          <span className="hidden text-[11px] text-soft sm:inline">{clock}</span>
          <button
            onClick={() => {
              setMuted(!muted);
              setMutedState(!muted);
            }}
            title={muted ? "Sound off" : "Sound on"}
            aria-label={muted ? "Turn sound on" : "Turn sound off"}
            className="p-1 text-soft hover:text-core"
          >
            {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
        </div>
      </header>

      {/* ───── Workspace grid: nothing overlaps; each region owns its space ───── */}
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,42dvh)_auto_minmax(0,1fr)] gap-2 p-2 lg:grid-cols-[292px_minmax(0,1fr)_380px] lg:grid-rows-1 lg:gap-3 lg:p-3 2xl:grid-cols-[320px_minmax(0,1fr)_420px]">
        {/* Left column: desktop always; phone shows it under the tabs for Profile / Activity */}
        <aside
          className={cx(
            "in-left no-scrollbar order-3 min-h-0 flex-col gap-3 overflow-y-auto lg:order-none lg:flex",
            tab === "operator" || tab === "log" ? "flex" : "hidden",
          )}
        >
          <div className={cx("flex-col gap-3", tab === "operator" ? "flex" : "hidden lg:flex")}>{operator}</div>
          <div className={tab === "log" ? "block" : "hidden lg:block"}>{activityLog}</div>
        </aside>

        {/* Stage */}
        <section className="in-stage relative order-1 min-h-0 overflow-hidden border border-line bg-bg lg:order-none" aria-label="Knowledge galaxy">
          <Galaxy
            onReady={(s) => {
              sceneRef.current = s;
              setSceneReady(!!s);
            }}
            onHover={(node, x, y) => {
              if (node && node.id !== hover?.node.id) sfx.hover();
              setHover(node ? { node, x, y } : null);
            }}
            onSelectNode={(n) => {
              setSelected(n);
              sfx.lock();
            }}
            onSelectProject={focusProject}
          />
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,oklch(0.12_0.01_250/0.7)_100%)]" />
          {/* frame corners */}
          <div aria-hidden className="hud-frame pointer-events-none absolute inset-2 [--s:18px]" />

          <div className="pointer-events-none absolute left-4 top-3 flex items-center gap-3">
            <span className="font-mono text-[10.5px] tracking-[0.22em] text-data">NEURAL MAP</span>
            <span className="font-mono text-[10px] tracking-widest text-faint">{galaxy.data ? `${galaxy.data.nodes.length} NODES · ${galaxy.data.projects.length} SECTORS` : "…"}</span>
          </div>
          <div className="pointer-events-none absolute right-4 top-2 hidden md:block">
            <Compass read={readTelemetry} />
          </div>
          {focus && (
            <button
              onClick={() => focusProject(null)}
              className="absolute left-4 top-9 flex items-center gap-1.5 border border-core/50 bg-bg/70 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-core"
            >
              <Crosshair size={11} /> {focus.name} <X size={10} />
            </button>
          )}

          {selected && (
            <div className="absolute left-1/2 top-12 z-10 w-[min(380px,calc(100%-2rem))] -translate-x-1/2">
              <Holo
                tone="core"
                title={`Node · ${selected.kind}${selected.subtype ? ` · ${selected.subtype.replace("_", " ")}` : ""}`}
                right={
                  <button onClick={() => setSelected(null)} aria-label="Close" className="text-soft hover:text-fg">
                    <X size={14} />
                  </button>
                }
                className="holo-glitch"
              >
                <div className="p-4">
                  <div className="text-[14px] font-medium">{selected.title}</div>
                  <div className="mt-3 flex gap-2">
                    <button onClick={() => send(`Tell me about "${selected.title}"`)} className="bg-core px-3 py-1.5 text-xs font-medium text-core-ink hover:bg-core/85">
                      Ask HIVEMIND
                    </button>
                    <Link href={selected.href} className="border border-data/40 px-3 py-1.5 text-xs text-data hover:border-data">
                      Open record →
                    </Link>
                  </div>
                </div>
              </Holo>
            </div>
          )}

          {/* Sector strip */}
          <div className="absolute inset-x-0 bottom-0 border-t border-line bg-sunken/85">
            <div className="no-scrollbar flex items-center gap-1 overflow-x-auto px-3 py-2">
              <span className="mr-1 shrink-0 font-mono text-[10px] tracking-[0.2em] text-faint">SECTORS</span>
              {b?.projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => focusProject(focus?.id === p.id ? null : { id: p.id, name: p.name, status: p.status, cluster: p.metadata?.cluster ?? null })}
                  className={cx(
                    "flex shrink-0 items-center gap-1.5 border px-2 py-1 text-[12px] transition-colors",
                    focus?.id === p.id ? "border-core bg-core/15 text-core" : "border-transparent text-soft hover:border-line hover:text-fg",
                  )}
                >
                  <span className="h-1.5 w-1.5 rotate-45 bg-core" />
                  {p.name}
                  <span className="font-mono text-[10px] text-faint">{p.items}</span>
                </button>
              ))}
              <button
                onClick={() => brainAction("organize", { action: "organize" })}
                disabled={!!busyAction}
                className="ml-auto flex shrink-0 items-center gap-1 px-2 py-1 font-mono text-[10px] tracking-widest text-soft hover:text-core disabled:opacity-40"
                title="File unfiled knowledge into projects"
              >
                <Wand2 size={12} className={busyAction === "organize" ? "animate-pulse text-core" : ""} /> ORGANIZE
              </button>
            </div>
          </div>
        </section>

        {/* Phone: tabs between stage and content */}
        <div className="order-2 flex gap-1 lg:hidden" role="tablist" aria-label="Panels">
          {(
            [
              ["console", "Console"],
              ["operator", "Profile"],
              ["log", "Activity"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={cx("flex-1 border py-1.5 font-mono text-[10.5px] uppercase tracking-widest", tab === k ? "border-core bg-core/15 text-core" : "border-line text-soft")}
            >
              {label}
            </button>
          ))}
        </div>
        {/* Right column: the console (single instance; phone shows it under the Console tab) */}
        <aside className={cx("in-right order-3 min-h-0 flex-col lg:order-none lg:flex", tab === "console" ? "flex" : "hidden")}>{consolePanel}</aside>
      </div>

      {hover && (
        <div className="pointer-events-none fixed z-30" style={{ left: hover.x + 16, top: hover.y + 16 }}>
          <div className="holo" style={{ ["--cut" as string]: "8px" }}>
            <div className="holo-in max-w-64 px-3 py-2">
              <div className="flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-widest text-data">
                <span className={cx("h-1.5 w-1.5 rounded-full", KIND_DOT[hover.node.kind])} />
                {hover.node.kind}
                {hover.node.subtype ? ` · ${hover.node.subtype.replace("_", " ")}` : ""}
              </div>
              <div className="mt-0.5 text-[13px] leading-snug">{hover.node.title}</div>
            </div>
          </div>
        </div>
      )}

      {(brain.error || galaxy.error) && (
        <div className="absolute left-1/2 top-16 z-30 -translate-x-1/2 border border-alert/50 bg-bg/90 px-3 py-2 font-mono text-[11px] text-alert">
          LINK FAILURE: {brain.error ?? galaxy.error}
        </div>
      )}
    </div>
  );
}
