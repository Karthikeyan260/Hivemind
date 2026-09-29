"use client";

import {
  ArrowUp,
  Brain,
  Eye,
  EyeOff,
  FileText,
  FolderKanban,
  Radar,
  RefreshCw,
  Search,
  Settings,
  StickyNote,
  Undo2,
  Volume2,
  VolumeX,
  Wand2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Boot } from "@/components/bridge/boot";
import { Gauge, Holo, Meter } from "@/components/bridge/holo";
import type { CoreState } from "@/components/core";
import { Decrypt } from "@/components/fx";
import { Galaxy, type GNode, type GProject } from "@/components/galaxy/galaxy";
import type { GalaxyScene, Telemetry } from "@/components/galaxy/scene";
import { cx, RichText } from "@/components/ui";
import { api, type Brain as BrainT, type HiveEvent, type Source, streamHivemind, useFetch } from "@/lib/client-api";
import { isMuted, setMuted, sfx } from "@/lib/sfx";

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

const NAV = [
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/memories", label: "Memories", icon: Brain },
  { href: "/notes", label: "Notes", icon: StickyNote },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/sources", label: "Sources", icon: Radar },
  { href: "/search", label: "Search", icon: Search },
  { href: "/settings", label: "Settings", icon: Settings },
];
const KIND_DOT: Record<string, string> = { memory: "bg-data", note: "bg-ok", document: "bg-[#b59cff]" };
const INTENT: Record<string, string> = { SEARCH: "RECALL", STORE_MEMORY: "STORED", UPDATE_MEMORY: "UPDATE", CREATE_PROJECT: "NEW SECTOR", GENERAL_CHAT: "COMMS" };

export default function BridgePage() {
  return (
    <Suspense>
      <Bridge />
    </Suspense>
  );
}

const idFromHref = (href: string) => href.split("open=")[1] ?? "";

function Bridge() {
  const params = useSearchParams();
  const brain = useFetch<BrainT>("/api/brain");
  const galaxy = useFetch<GalaxyData>("/api/galaxy");
  const sceneRef = useRef<GalaxyScene | null>(null);
  const [sceneReady, setSceneReady] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const holoEndRef = useRef<HTMLDivElement>(null);

  const [state, setState] = useState<CoreState>("idle");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [holoOpen, setHoloOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [focus, setFocus] = useState<GProject | null>(null);
  const [hover, setHover] = useState<{ node: GNode; x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<GNode | null>(null);
  const [hud, setHud] = useState(true);
  const [drawer, setDrawer] = useState<"left" | "right" | null>(null);
  const [muted, setMutedState] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [clock, setClock] = useState("");
  const [tele, setTele] = useState<Telemetry | null>(null);

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

  // Feed data into the scene once both exist.
  useEffect(() => {
    if (sceneReady && galaxy.data) sceneRef.current?.setData(galaxy.data.nodes, galaxy.data.projects);
  }, [sceneReady, galaxy.data]);

  useEffect(() => {
    sceneRef.current?.setState(state);
  }, [state]);

  useEffect(() => {
    sceneRef.current?.setSelected(selected?.id ?? null);
  }, [selected]);

  // Deep link: /?project=<id>
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

  // Mouse parallax for the leaning HUD panels.
  useEffect(() => {
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = rootRef.current;
        if (!el) return;
        el.style.setProperty("--mx", String((e.clientX / window.innerWidth - 0.5) * 2));
        el.style.setProperty("--my", String((e.clientY / window.innerHeight - 0.5) * 2));
      });
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  useEffect(() => {
    holoEndRef.current?.scrollIntoView({ block: "end" });
  }, [turns]);

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
      setHoloOpen(true);
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

  // Keyboard: "/" to type, Esc to reset view, H to hide HUD.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA";
      if (e.key === "/" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.key === "Escape") {
        setSelected(null);
        setHoloOpen(false);
        focusProject(null);
        (e.target as HTMLElement)?.blur?.();
      } else if ((e.key === "h" || e.key === "H") && !typing) {
        setHud((v) => !v);
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

  const statusText = state === "thinking" ? "SCANNING LATTICE" : state === "answering" ? "TRANSMITTING" : focus ? `SECTOR // ${focus.name.toUpperCase()}` : "STANDING BY";
  const lastTurn = turns[turns.length - 1];

  return (
    <div ref={rootRef} className="bridge fixed inset-0 overflow-hidden bg-bg text-fg">
      <Boot lines={bootLines} ready={!!galaxy.data && !!b} />

      <Galaxy
        dimLabels={holoOpen && turns.length > 0}
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

      {/* vignette so HUD text stays legible over the galaxy */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,oklch(0.12_0.01_250/0.85)_100%)]" />

      {/* ───── Top bar ───── */}
      <header className="absolute inset-x-0 top-0 z-20 flex items-center gap-4 px-4 py-3 md:px-6">
        <div className="flex items-center gap-3">
          <span className="relative flex h-2.5 w-2.5">
            <span className={cx("absolute inline-flex h-full w-full rounded-full bg-core opacity-60", state !== "idle" ? "animate-ping" : "motion-safe:animate-pulse")} />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-core" />
          </span>
          <span className="font-mono text-sm font-semibold tracking-[0.35em]">HIVEMIND</span>
          <span className="hidden font-mono text-[10.5px] tracking-[0.2em] text-data md:inline">{statusText}</span>
        </div>
        <div className="ml-auto hidden items-center gap-4 font-mono text-[10.5px] tabular-nums tracking-widest text-faint md:flex">
          {tele && (
            <>
              <span className="eq flex items-end" aria-hidden>
                {[0, 1, 2, 3, 4].map((i) => (
                  <span key={i} style={{ animationDelay: `${i * 0.13}s`, animationDuration: state === "idle" ? "2.4s" : "0.6s" }} />
                ))}
              </span>
              <span>FPS <b className="font-normal text-data">{tele.fps}</b></span>
              <span>RNG <b className="font-normal text-data">{tele.distance}</b></span>
              <span>NODES <b className="font-normal text-data">{tele.nodes}</b></span>
              <span>LOCK <b className={cx("font-normal", tele.locked ? "text-core" : "text-data")}>{String(tele.locked).padStart(2, "0")}</b></span>
            </>
          )}
          <span className="text-[11px] text-soft">{clock}</span>
        </div>
        <nav className="flex items-center gap-0.5" aria-label="Main">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} title={label} aria-label={label} className="hidden rounded-md p-2 text-soft transition-colors hover:bg-raised/70 hover:text-core sm:block">
              <Icon size={16} strokeWidth={1.75} />
            </Link>
          ))}
          <span className="mx-1 hidden h-5 w-px bg-line sm:block" />
          <button
            onClick={() => {
              setMuted(!muted);
              setMutedState(!muted);
            }}
            title={muted ? "Sound off" : "Sound on"}
            aria-label={muted ? "Turn sound on" : "Turn sound off"}
            className="rounded-md p-2 text-soft hover:bg-raised/70 hover:text-core"
          >
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <button onClick={() => setHud((v) => !v)} title="Toggle HUD (H)" aria-label="Toggle HUD" className="rounded-md p-2 text-soft hover:bg-raised/70 hover:text-core">
            {hud ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </nav>
      </header>

      {/* mobile drawer toggles */}
      <div className="absolute left-4 top-14 z-20 flex gap-2 lg:hidden">
        {(["left", "right"] as const).map((d) => (
          <button
            key={d}
            onClick={() => setDrawer(drawer === d ? null : d)}
            className={cx("border px-2.5 py-1 font-mono text-[10.5px] tracking-widest", drawer === d ? "border-core bg-core text-core-ink" : "border-data/40 text-data")}
          >
            {d === "left" ? "OPERATOR" : "LOG"}
          </button>
        ))}
        <Link href="/projects" className="border border-data/40 px-2.5 py-1 font-mono text-[10.5px] tracking-widest text-data sm:hidden">
          MENU
        </Link>
      </div>

      {/* ───── Left: Operator ───── */}
      <aside
        className={cx(
          "absolute bottom-40 left-4 top-24 z-10 w-[300px] flex-col gap-3 overflow-y-auto overflow-x-hidden transition-opacity duration-300 lg:left-6 lg:top-16 lg:flex",
          hud ? "opacity-100" : "pointer-events-none opacity-0",
          drawer === "left" ? "flex" : "hidden",
        )}
      >
        <div className="lean-left flex flex-col gap-3">
          <Holo title="Operator" right={<span className="font-mono text-[10px] text-faint">ID-01</span>} className="holo-glitch">
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
                  No operator profile yet. <Link href="/sources" className="text-data underline-offset-2 hover:underline">Sync your portfolio</Link>.
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
            <Holo title="Composition" className="holo-glitch [animation-delay:150ms]">
              <div className="space-y-2.5 p-4">
                {composition.map(([k, v]) => (
                  <Meter key={k} label={k} value={v} max={composition[0][1]} />
                ))}
              </div>
            </Holo>
          )}

          {b?.profile?.focus_areas.length ? (
            <Holo title="Focus vectors" className="holo-glitch [animation-delay:300ms]">
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
        </div>
      </aside>

      {/* ───── Right: Sectors + Activity ───── */}
      <aside
        className={cx(
          "absolute bottom-40 right-4 top-24 z-10 w-[310px] flex-col gap-3 overflow-y-auto overflow-x-hidden transition-opacity duration-300 lg:right-6 lg:top-16 lg:flex",
          hud ? "opacity-100" : "pointer-events-none opacity-0",
          drawer === "right" ? "flex" : "hidden",
        )}
      >
        <div className="lean-right flex flex-col gap-3">
          <Holo
            title={`Sectors · ${b?.projects.length ?? 0}`}
            right={
              <button
                onClick={() => brainAction("organize", { action: "organize" })}
                disabled={!!busyAction}
                className="flex items-center gap-1 font-mono text-[10px] tracking-widest text-soft hover:text-core disabled:opacity-40"
                title="File unfiled knowledge into projects"
              >
                <Wand2 size={12} className={busyAction === "organize" ? "animate-pulse text-core" : ""} /> ORGANIZE
              </button>
            }
            className="holo-glitch [animation-delay:80ms]"
          >
            <ul className="max-h-64 overflow-y-auto p-2">
              {b?.projects.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => focusProject(focus?.id === p.id ? null : { id: p.id, name: p.name, status: p.status, cluster: p.metadata?.cluster ?? null })}
                    className={cx(
                      "flex w-full items-center gap-2.5 px-2 py-1.5 text-left text-[12.5px] transition-colors",
                      focus?.id === p.id ? "bg-core/15 text-core" : "text-soft hover:bg-data/5 hover:text-fg",
                    )}
                  >
                    <span className="h-1.5 w-1.5 rotate-45 bg-core" />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    {p.metadata?.auto && <span className="font-mono text-[9px] text-core">AUTO</span>}
                    <span className="font-mono text-[10.5px] tabular-nums text-faint">{p.items}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Holo>

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
            className="holo-glitch [animation-delay:220ms]"
          >
            <ol className="max-h-72 space-y-2 overflow-y-auto p-4 font-mono text-[11px] leading-snug">
              {(b?.activity ?? []).slice(0, 14).map((a) => (
                <li key={a.id} className="flex gap-2">
                  <span className="shrink-0 text-faint">
                    {new Date(a.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}
                  </span>
                  <span className={cx("min-w-0 flex-1", a.undone ? "text-faint line-through" : "text-soft")}>{a.message}</span>
                  {a.undoable && (
                    <button
                      onClick={() => brainAction(a.id, { action: "undo", id: a.id })}
                      disabled={!!busyAction}
                      className="shrink-0 text-faint hover:text-core"
                      title="Undo"
                      aria-label={`Undo: ${a.message}`}
                    >
                      <Undo2 size={11} />
                    </button>
                  )}
                </li>
              ))}
              {b && b.activity.length === 0 && <li className="text-faint">No autonomous actions yet.</li>}
            </ol>
          </Holo>
        </div>
      </aside>

      {/* ───── Hover tooltip ───── */}
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

      {/* ───── Selected node ───── */}
      {selected && (
        <div className="absolute left-1/2 top-16 z-20 w-[min(440px,calc(100%-2rem))] -translate-x-1/2">
          <Holo
            tone="core"
            title={`Node // ${selected.kind}${selected.subtype ? ` · ${selected.subtype.replace("_", " ")}` : ""}`}
            right={
              <button onClick={() => setSelected(null)} aria-label="Close" className="text-soft hover:text-fg">
                <X size={14} />
              </button>
            }
            className="holo-glitch"
          >
            <div className="p-4">
              <div className="text-[15px] font-medium">{selected.title}</div>
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

      {/* ───── Hologram (answers) ───── */}
      {holoOpen && turns.length > 0 && (
        <div className="absolute bottom-[120px] left-1/2 z-20 w-[min(680px,calc(100%-2rem))] -translate-x-1/2">
          <Holo
            tone={state !== "idle" ? "core" : undefined}
            title={
              <span className="flex items-center gap-2">
                Transmission
                {lastTurn?.intent && <span className="text-core">· {INTENT[lastTurn.intent] ?? lastTurn.intent}</span>}
              </span>
            }
            right={
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    setTurns([]);
                    setConversationId(null);
                    sceneRef.current?.clearHighlight();
                  }}
                  className="font-mono text-[10px] tracking-widest text-soft hover:text-core"
                >
                  NEW SESSION
                </button>
                <button
                  onClick={() => {
                    setHoloOpen(false);
                    sceneRef.current?.clearHighlight();
                  }}
                  aria-label="Close transmission"
                  className="text-soft hover:text-fg"
                >
                  <X size={14} />
                </button>
              </div>
            }
            className="holo-glitch"
            bodyClassName="max-h-[min(52vh,560px)] !bg-[linear-gradient(160deg,oklch(0.2_0.022_235/0.95),oklch(0.14_0.015_250/0.97))]"
          >
            <div className="flex-1 space-y-6 overflow-y-auto px-5 py-4">
              {turns.map((t, i) => (
                <div key={i} className="rise-in">
                  <div className="mb-2 flex gap-2 font-mono text-[11.5px] text-core">
                    <span>▸</span>
                    <span className="text-fg/80">{t.q}</span>
                  </div>
                  {t.streaming && !t.a ? (
                    <div className="font-mono text-[12px] text-data">
                      {t.sources?.length ? `LOCKED ${t.sources.length} NODES · SYNTHESIZING` : "SCANNING NEURAL LATTICE"}
                      <span className="stream-caret" aria-hidden />
                    </div>
                  ) : (
                    <div className={cx("text-[14.5px]", t.error ? "text-alert" : "text-fg/90")}>
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
                        <Link
                          key={s.n}
                          href={s.href}
                          title={s.title}
                          className="flex max-w-56 items-center gap-1.5 border border-data/25 px-1.5 py-0.5 font-mono text-[10px] text-soft hover:border-data hover:text-data"
                        >
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
              <div ref={holoEndRef} />
            </div>
          </Holo>
        </div>
      )}

      {/* ───── Command bar ───── */}
      <div className="absolute inset-x-0 bottom-0 z-20 px-4 pb-5 md:px-6">
        <div className="mx-auto w-full max-w-[680px]">
          {turns.length === 0 && state === "idle" && b?.profile && (
            <div className="stagger mb-3 flex flex-wrap justify-center gap-2">
              {[
                "Brief me on who I am",
                "What have I been working on lately?",
                focus ? `Status of ${focus.name}` : b.projects[0] ? `Story of ${b.projects[0].name}` : null,
              ]
                .filter(Boolean)
                .map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s!)}
                    className="border border-data/25 bg-bg/60 px-3 py-1.5 text-[12.5px] text-soft backdrop-blur-sm transition-colors hover:border-core hover:text-core"
                  >
                    {s}
                  </button>
                ))}
            </div>
          )}
          {!holoOpen && turns.length > 0 && (
            <button onClick={() => setHoloOpen(true)} className="mx-auto mb-2 block font-mono text-[10px] tracking-widest text-data hover:text-core">
              ▴ REOPEN TRANSMISSION ({turns.length})
            </button>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <Holo tone={state !== "idle" ? "core" : undefined}>
              <div className="flex items-center gap-3 px-4 py-2.5">
                <span className={cx("font-mono text-sm", state !== "idle" ? "animate-pulse text-core" : "text-data")}>▸</span>
                {focus && (
                  <button
                    type="button"
                    onClick={() => focusProject(null)}
                    className="flex shrink-0 items-center gap-1 bg-core/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-core"
                    title="Clear sector scope"
                  >
                    {focus.name} <X size={10} />
                  </button>
                )}
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={state === "idle" ? "Speak to HIVEMIND…" : "Processing…"}
                  aria-label="Message HIVEMIND"
                  className="min-w-0 flex-1 bg-transparent py-1.5 text-[15px] text-fg outline-none placeholder:text-faint"
                  disabled={state !== "idle"}
                />
                <button
                  type="submit"
                  disabled={state !== "idle" || !input.trim()}
                  aria-label="Send"
                  className="flex h-8 w-8 shrink-0 items-center justify-center bg-core text-core-ink transition-opacity disabled:opacity-25"
                  style={{ clipPath: "polygon(6px 0,100% 0,100% calc(100% - 6px),calc(100% - 6px) 100%,0 100%,0 6px)" }}
                >
                  <ArrowUp size={16} strokeWidth={2.4} />
                </button>
              </div>
            </Holo>
          </form>
          <div className="mt-2 hidden items-center justify-center gap-4 font-mono text-[9.5px] uppercase tracking-widest text-faint md:flex">
            <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-data" />memory</span>
            <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-ok" />note</span>
            <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[#b59cff]" />document</span>
            <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rotate-45 bg-core" />project</span>
            <span>· drag · scroll · click a star · H hides HUD</span>
          </div>
        </div>
      </div>

      {(brain.error || galaxy.error) && (
        <div className="absolute left-1/2 top-16 z-30 -translate-x-1/2 border border-alert/50 bg-bg/90 px-3 py-2 font-mono text-[11px] text-alert">
          LINK FAILURE: {brain.error ?? galaxy.error}
        </div>
      )}
    </div>
  );
}
