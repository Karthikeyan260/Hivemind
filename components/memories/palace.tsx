"use client";

import { ChevronLeft, ChevronRight, Home, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Scramble } from "@/components/bridge/scramble";
import { useVoiceActions } from "@/components/voice/provider";
import { HUB_R, WINGS, wingOf, type PalaceItem, type PalaceScene, type WingLayout, type Zone } from "./palace-scene";

type Props = {
  items: PalaceItem[];
  /** Search / filter matches to light up (null: no search active). */
  highlight: string[] | null;
  openId: string | null;
  /** Memories related to the open one: drawn as threads of light. */
  related: string[];
  onOpen: (id: string) => void;
  /** Close the open memory (walked away, set off elsewhere, or Esc). */
  onClose: (id?: string) => void;
  /** 3D couldn't start on this device (no WebGL, or its code isn't here offline): the page shows the list instead. */
  onUnavailable?: () => void;
};

const KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight"]);

/** The Memory Palace: a walkable 3D museum of the owner's memories (Memory page "Palace" view). */
export function Palace({ items, highlight, openId, related, onOpen, onClose, onUnavailable }: Props) {
  const unavailableRef = useRef(onUnavailable);
  useEffect(() => {
    unavailableRef.current = onUnavailable;
  }, [onUnavailable]);
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<PalaceScene | null>(null);
  const openRef = useRef(onOpen);
  const closeRef = useRef(onClose);
  useEffect(() => {
    openRef.current = onOpen;
    closeRef.current = onClose;
  }, [onOpen, onClose]);
  const [layout, setLayout] = useState<WingLayout[]>([]);
  const [me, setMe] = useState<{ x: number; z: number; yaw: number; zone: Zone }>({ x: 0, z: 2.5, yaw: 0, zone: { kind: "hub" } });
  // Map jumps: a wash of the destination's light (250 ms in, swap, 450 ms out) instead of a black cut.
  const [fade, setFade] = useState<{ on: boolean; color: string }>({ on: false, color: "#f2c46d" });
  const [hint, setHint] = useState(true);
  const [touch, setTouch] = useState(false);
  const [failed, setFailed] = useState(false);
  // the memory under the mouse, and where the mouse is (a label follows it; mouse only, not touch)
  const [hoverId, setHoverId] = useState<string | null>(null);
  const tip = useRef<HTMLDivElement>(null);
  // step to the neighbouring memory along the wall; a short note when there is none that way
  const [edge, setEdge] = useState<string | null>(null);
  const step = (dir: 1 | -1) => {
    const id = scene.current?.neighbour(dir);
    if (id) setEdge(null);
    else {
      setEdge(dir > 0 ? "That's the last one this way" : "That's the first one");
      setTimeout(() => setEdge(null), 1600);
    }
  };
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  });

  // Build the scene once per set of memories.
  const key = items.map((i) => `${i.id}:${i.updated_at}:${i.importance}`).join("|");
  useEffect(() => {
    if (!canvas.current || !items.length) return;
    let alive = true;
    let s: PalaceScene | null = null;
    setTouch(matchMedia("(pointer: coarse)").matches);
    (async () => {
      await document.fonts?.ready;
      try {
        // Offline before the palace was ever opened, its 3D code isn't on this device yet.
        const mod = await import("./palace-scene");
        if (!alive || !canvas.current) return;
        s = new mod.PalaceScene(canvas.current, items, {
          onOpen: (id) => openRef.current(id),
          onClose: (id) => closeRef.current(id),
          onMove: (x, z, yaw, zone) => setMe({ x, z, yaw, zone }),
          onHover: (id) => setHoverId(id),
        });
      } catch (err) {
        console.warn("palace unavailable, showing the list:", err instanceof Error ? err.message : err);
        setFailed(true);
        unavailableRef.current?.();
        return;
      }
      scene.current = s;
      setLayout(s.layout);
      const el = wrap.current!;
      s.resize(el.clientWidth, el.clientHeight);
    })();
    return () => {
      alive = false;
      s?.dispose();
      scene.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuild only when the memories change
  }, [key]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => scene.current?.resize(el.clientWidth, el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    scene.current?.setHighlight(highlight);
  }, [highlight, layout]);

  useEffect(() => {
    scene.current?.setRelated(openId, related);
  }, [openId, related, layout]);

  // Keyboard walking, unless the owner is typing somewhere.
  useEffect(() => {
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLElement && (e.target.closest("input, textarea, select, [contenteditable=true]") !== null);
    const down = (e: KeyboardEvent) => {
      if (e.code === "Escape" && !typing(e)) return closeRef.current();
      // [ and ]: the previous / next memory along the wall (the arrows already walk)
      if ((e.code === "BracketLeft" || e.code === "BracketRight") && !typing(e) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        stepRef.current(e.code === "BracketRight" ? 1 : -1);
        return;
      }
      if (!KEYS.has(e.code) || typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code.startsWith("Arrow")) e.preventDefault();
      scene.current?.setKeys(e.code, true);
      setHint(false);
    };
    const up = (e: KeyboardEvent) => scene.current?.setKeys(e.code, false);
    const blur = () => KEYS.forEach((k) => scene.current?.setKeys(k, false));
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  // Long trips (map jumps) dissolve through a wash of the destination's colour instead of flying.
  const jump = (to: "hub" | number) => {
    const color = to === "hub" ? "#f2c46d" : WINGS[to].color;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return scene.current?.jumpTo(to);
    setFade({ on: true, color });
    setTimeout(() => {
      scene.current?.jumpTo(to);
      setFade({ on: false, color });
    }, 260);
  };

  // Voice: move through the palace and open memories by speaking.
  const byId = new Map(items.map((i) => [i.id, i]));
  const findMemories = (q: string) => {
    const words = q.toLowerCase().split(/\W+/).filter((w) => w.length > 1);
    return items
      .map((m) => {
        const title = m.title.toLowerCase();
        const body = m.snippet.toLowerCase();
        return { m, score: words.reduce((a, w) => a + (title.includes(w) ? 2 : body.includes(w) ? 1 : 0), 0) };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.m.importance - a.m.importance)
      .map((x) => x.m);
  };
  const where = () => {
    const a = scene.current?.around(5);
    if (!a) return { error: "The palace is still loading." };
    return {
      you_are_in: a.zone.kind === "wing" ? WINGS[a.zone.index].name : "the Rotunda",
      memory_open: a.open ? byId.get(a.open)?.title ?? null : null,
      nearest_memories: a.near.map((n) => `${byId.get(n.id)?.title ?? "?"} (${Math.round(n.d)} m)`),
      wings: layout.map((w) => `${w.wing.name}: ${w.items.length}`),
    };
  };
  useVoiceActions({
    palace_go: {
      description: "Memory Palace: go to a wing or back to the rotunda. input: 'knowledge', 'experience', 'projects', 'ideas', 'self' (preferences) or 'rotunda'.",
      run: ({ input }) => {
        const q = String(input ?? "").toLowerCase();
        if (/rotunda|hub|centre|center|start|back/.test(q)) return (jump("hub"), { going_to: "the Rotunda" });
        const i = WINGS.findIndex((w) => q.includes(w.id) || w.name.toLowerCase().includes(q) || w.types.some((t) => q.includes(t.replace("_", " ")) || q.includes(t)) || (w.id === "self" && /prefer/.test(q)) || (w.id === "projects" && /project/.test(q)) || (w.id === "ideas" && /idea/.test(q)));
        if (i < 0) return { error: `No wing like "${input}".`, wings: WINGS.map((w) => w.name) };
        jump(i);
        return { going_to: WINGS[i].name, memories_there: layout[i]?.items.length ?? 0 };
      },
    },
    palace_walk: {
      description: "Memory Palace: walk. input: direction (forward, back, left, right) and optional metres, e.g. 'forward 5'. Walls stop the walk.",
      run: ({ input }) => {
        const q = String(input ?? "forward").toLowerCase();
        const dir = /back|behind/.test(q) ? "back" : /left/.test(q) ? "left" : /right/.test(q) ? "right" : "forward";
        const m = Number(q.match(/\d+(\.\d+)?/)?.[0] ?? 3);
        const walked = scene.current?.walk(dir, m) ?? 0;
        return walked ? { walked_m: walked, direction: dir } : { error: "A wall is in the way." };
      },
    },
    palace_turn: {
      description: "Memory Palace: turn on the spot. input: 'left', 'right', 'around', optionally with degrees ('right 45').",
      run: ({ input }) => {
        const q = String(input ?? "around").toLowerCase();
        const deg = /around|back/.test(q) ? 180 : Number(q.match(/\d+/)?.[0] ?? 90);
        const sign = /right/.test(q) ? -1 : 1;
        scene.current?.turn(((sign * deg) / 180) * Math.PI);
        return { turned_degrees: deg, direction: sign > 0 ? "left" : "right" };
      },
    },
    palace_open: {
      description: "Memory Palace: walk to a memory and open it. input: words from its title or content, e.g. 'Zinnov', 'Amma phone number'.",
      run: ({ input }) => {
        const hits = findMemories(String(input ?? ""));
        if (!hits.length) return { error: `No memory matches "${input}".` };
        scene.current?.focus(hits[0].id);
        return { opening: hits[0].title, type: hits[0].memory_type, other_matches: hits.slice(1, 4).map((m) => m.title) };
      },
    },
    palace_next: {
      description: "Memory Palace: step to the next memory along the wall and open it (from the open one, or the nearest).",
      run: () => {
        const id = scene.current?.neighbour(1);
        return id ? { opening: byId.get(id)?.title } : { error: "No more memories this way." };
      },
    },
    palace_previous: {
      description: "Memory Palace: step to the previous memory along the wall and open it.",
      run: () => {
        const id = scene.current?.neighbour(-1);
        return id ? { opening: byId.get(id)?.title } : { error: "This is the first one." };
      },
    },
    palace_close: { description: "Memory Palace: close the open memory panel.", run: () => (onClose(), { closed: true }) },
    palace_find: {
      description: "Memory Palace: light up every memory matching some words and walk to the best one. input: words, e.g. 'Python', 'college'.",
      run: ({ input }) => {
        const hits = findMemories(String(input ?? ""));
        if (!hits.length) return { error: `Nothing matches "${input}".` };
        scene.current?.setHighlight(hits.map((m) => m.id));
        scene.current?.focus(hits[0].id);
        return { lit_up: hits.length, opening: hits[0].title, others: hits.slice(1, 5).map((m) => m.title) };
      },
    },
    palace_where: { description: "Memory Palace: where the owner is standing, the memories nearest them, and what is in each wing.", run: () => where() },
  });

  const zoneWing = me.zone.kind === "wing" ? WINGS[me.zone.index] : null;
  const zoneCount = me.zone.kind === "wing" ? layout[me.zone.index]?.items.length ?? 0 : items.length;
  const matches = highlight?.length ?? 0;
  // which match was walked to last (‹ › go through them in order, wrapping round)
  const [hit, setHit] = useState(-1);
  const hlKey = highlight?.join(",") ?? "";
  const [seenKey, setSeenKey] = useState(hlKey);
  if (seenKey !== hlKey) {
    setSeenKey(hlKey);
    setHit(-1);
  }
  const goMatch = (i: number) => {
    if (!highlight?.length) return;
    const n = (i + highlight.length) % highlight.length;
    setHit(n);
    scene.current?.focus(highlight[n]);
  };

  if (failed) return <p className="border border-line p-6 text-sm text-soft">3D isn&apos;t available on this device. Switch to List view.</p>;

  return (
    <div
      ref={wrap}
      onPointerMove={(e) => {
        const t = tip.current;
        const box = wrap.current?.getBoundingClientRect();
        if (!t || !box || e.pointerType !== "mouse") return;
        // keep the label inside the palace: flip to the left of the pointer near the right edge
        const x = e.clientX - box.left;
        const left = x + 16 + 260 > box.width ? x - 16 - 260 : x + 16;
        t.style.transform = `translate(${Math.max(8, left)}px, ${Math.max(8, e.clientY - box.top + 14)}px)`;
      }}
      className="palace relative h-[70dvh] min-h-[420px] sm:h-[calc(100dvh-20rem)] w-full overflow-hidden border border-line bg-[#06080d]" onPointerDown={() => setHint(false)}>
      <canvas ref={canvas} className="block h-full w-full outline-none" aria-label="Memory Palace: walk through your memories. Use List view for a text list." />

      {/* Where am I: the meta line decodes, the name rises out of a mask, the tagline follows. */}
      <div key={zoneWing?.id ?? "hub"} className="pointer-events-none absolute left-3 top-3 max-w-[55%] sm:max-w-[62%] rounded-md bg-[#0b0e15]/60 px-2 py-1.5 backdrop-blur-sm">
        <p className="font-mono text-[10px] tracking-[0.25em]" style={{ color: zoneWing?.color ?? "#f2c46d" }}>
          <Scramble text={`${zoneWing ? "WING" : "ROTUNDA"} · ${zoneCount} ${zoneCount === 1 ? "MEMORY" : "MEMORIES"}`} />
        </p>
        <p className="mt-1 overflow-hidden text-lg font-medium tracking-wide text-fg">
          <span className="palace-rise block">{zoneWing?.name ?? "Memory Palace"}</span>
        </p>
        <p className="palace-follow text-[12px] text-soft">{zoneWing?.tagline ?? "Your most important memories stand here. Each doorway leads to a wing."}</p>
      </div>

      {me.zone.kind === "wing" && (
        <button type="button" onClick={() => jump("hub")} className={`absolute right-4 top-4 items-center gap-1.5 rounded-full border border-[#f2c46d]/40 bg-[#0b0e15]/80 px-3 py-1.5 font-mono text-[10.5px] tracking-widest text-[#f2c46d] backdrop-blur transition hover:border-[#f2c46d] hover:bg-[#f2c46d]/10 active:scale-[0.97] ${openId ? "hidden lg:flex" : "flex"}`}>
          <Home size={12} /> ROTUNDA
        </button>
      )}

      {/* Search matches: how many lit up, and a walk through them one by one */}
      {highlight && (
        <div
          className={`absolute z-20 flex items-center gap-1 rounded-full ${
            openId
              ? "top-3 right-3 lg:top-auto lg:right-auto lg:bottom-4 lg:left-[calc((100%-492px)/2)] lg:-translate-x-1/2"
              : `${me.zone.kind === "wing" ? "top-14" : "top-3"} right-3 lg:top-auto lg:right-auto lg:bottom-4 lg:left-1/2 lg:-translate-x-1/2`
          } border border-data/40 bg-[#0b0e15]/85 p-1 font-mono lg:pl-3 text-[11px] text-data shadow-2xl backdrop-blur-md`}
        >
          <Search size={12} className={`shrink-0 ${matches ? "hidden lg:block" : ""}`} />
          <span className={`pr-1 whitespace-nowrap ${matches ? "hidden lg:inline" : ""}`}>{matches ? `${matches} lit up` : "No matches here"}</span>
          {matches > 0 && (
            <>
              <button type="button" onClick={() => goMatch(hit - 1)} aria-label="Previous match" className="grid size-7 place-items-center rounded-full text-soft transition hover:bg-data/10 hover:text-data">
                <ChevronLeft size={14} />
              </button>
              <span className="min-w-[2.75rem] text-center text-fg tabular-nums lg:min-w-[3.25rem]">
                {hit >= 0 ? hit + 1 : "–"} / {matches}
              </span>
              <button type="button" onClick={() => goMatch(hit + 1)} aria-label="Next match" className="grid size-7 place-items-center rounded-full bg-data/15 text-data transition hover:bg-data/25">
                <ChevronRight size={14} />
              </button>
            </>
          )}
        </div>
      )}

      {/* Wings: one tap to any of them (wide screens; phones use the floor plan) */}
      {layout.length > 0 && !highlight && !openId && (
        <div className="absolute bottom-4 left-1/2 hidden -translate-x-1/2 items-center gap-1 rounded-full border border-white/10 bg-[#0b0e15]/75 p-1 backdrop-blur-md lg:flex">
          {layout.map((w, i) => {
            const here = me.zone.kind === "wing" && me.zone.index === i;
            return (
              <button
                key={w.wing.id}
                type="button"
                onClick={() => jump(i)}
                title={w.wing.tagline}
                aria-pressed={here}
                className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] whitespace-nowrap text-soft transition hover:text-fg"
                style={here ? { background: `${w.wing.color}26`, color: w.wing.color, boxShadow: `inset 0 0 0 1px ${w.wing.color}66` } : undefined}
              >
                <span className="size-1.5 rounded-full" style={{ background: w.wing.color, boxShadow: here ? `0 0 6px ${w.wing.color}` : undefined }} />
                {w.wing.name}
                <span className="font-mono text-[10px] opacity-60 tabular-nums">{w.items.length}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Floor plan: tap a wing to go there */}
      {layout.length > 0 && <MiniMap layout={layout} me={me} onJump={jump} />}

      {/* a memory is open: walk along the wall to the one before or after it */}
      {openId && layout.length > 0 && !highlight && (
        <div className="absolute top-3 right-3 z-20 flex flex-col items-end gap-1.5 lg:top-auto lg:right-auto lg:bottom-4 lg:left-[calc((100%-492px)/2)] lg:-translate-x-1/2 lg:items-center">
          {edge && <p className="rounded-full bg-[#0b0e15]/85 px-2.5 py-1 font-mono text-[10px] tracking-wider text-soft backdrop-blur">{edge}</p>}
          <div className="flex items-center rounded-full border border-white/10 bg-[#0b0e15]/80 p-1 backdrop-blur-md">
            <button type="button" onClick={() => step(-1)} aria-label="Previous memory" title="Previous memory ( [ )" className="flex items-center gap-1 rounded-full px-3 py-1.5 text-[12px] text-soft transition hover:bg-white/5 hover:text-fg active:scale-[0.97]">
              <ChevronLeft size={14} /> <span className="hidden lg:inline">Previous</span>
            </button>
            <span aria-hidden className="h-4 w-px bg-white/10" />
            <button type="button" onClick={() => step(1)} aria-label="Next memory" title="Next memory ( ] )" className="flex items-center gap-1 rounded-full px-3 py-1.5 text-[12px] text-soft transition hover:bg-white/5 hover:text-fg active:scale-[0.97]">
              <span className="hidden lg:inline">Next</span> <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* an empty wing: say plainly what belongs here and how to add one (the far wall's words are too small to read) */}
      {zoneWing && zoneCount === 0 && !openId && (
        <div key={zoneWing.id} className="palace-follow pointer-events-none absolute inset-x-0 top-[38%] flex justify-center px-6">
          <div className="max-w-sm rounded-xl border bg-[#0b0e15]/80 px-5 py-4 text-center shadow-2xl backdrop-blur-md" style={{ borderColor: `${zoneWing.color}55` }}>
            <p className="font-mono text-[10px] tracking-[0.25em] uppercase" style={{ color: zoneWing.color }}>
              Empty wing
            </p>
            <p className="mt-1.5 text-[14px] leading-snug text-fg">{zoneWing.empty}</p>
            <p className="mt-1.5 text-[11.5px] text-soft">Once saved, they hang on these walls.</p>
          </div>
        </div>
      )}

      {/* hovering a memory: its title and kind, readable at any distance */}
      {(() => {
        const m = hoverId && hoverId !== openId && !touch ? items.find((i) => i.id === hoverId) : null;
        const w = m ? wingOf(m.memory_type) : null;
        return (
          <div ref={tip} aria-hidden className="pointer-events-none absolute top-0 left-0 z-10 w-[260px]" style={{ opacity: m ? 1 : 0, transition: "opacity 120ms ease" }}>
            {m && w && (
              <div className="rounded-lg border bg-[#0b0e15]/92 px-3 py-2 shadow-2xl backdrop-blur-md" style={{ borderColor: `${w.color}66` }}>
                <p className="flex items-center gap-1.5 font-mono text-[9.5px] tracking-[0.18em] uppercase" style={{ color: w.color }}>
                  <span className="size-1.5 rounded-full" style={{ background: w.color }} />
                  {m.memory_type.replace(/_/g, " ")} · {w.name}
                </p>
                <p className="mt-1 line-clamp-2 text-[13px] leading-snug font-medium text-fg">{m.title}</p>
                {m.snippet && <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-soft">{m.snippet}</p>}
                <p className="mt-1.5 font-mono text-[9.5px] tracking-wider text-faint uppercase">Click to open</p>
              </div>
            )}
          </div>
        );
      })()}

      {/* a memory is open: shade the side its panel covers, so the panel reads as the focus */}
      <div aria-hidden className="pointer-events-none absolute inset-0 hidden bg-gradient-to-l from-[#06080d]/85 via-[#06080d]/35 to-transparent transition-opacity duration-500 lg:block" style={{ opacity: openId ? 1 : 0 }} />

      {hint && !openId && (
        <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center pl-36 pr-4 sm:pl-44 lg:bottom-16 lg:pl-4">
          <p className="border border-line bg-[#0b0e15]/80 px-3 py-1.5 text-center font-mono text-[10.5px] tracking-wider text-soft backdrop-blur">
            {touch ? "DRAG TO LOOK · TAP THE FLOOR TO WALK · TAP A MEMORY TO OPEN" : "DRAG TO LOOK · WASD OR CLICK THE FLOOR TO WALK · CLICK A MEMORY TO OPEN"}
          </p>
        </div>
      )}

      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(circle at 50% 55%, ${fade.color}cc 0%, ${fade.color}55 35%, #06080d 85%)`,
          opacity: fade.on ? 1 : 0,
          transition: fade.on ? "opacity 250ms cubic-bezier(0.3, 0, 0.8, 0.15)" : "opacity 450ms cubic-bezier(0.05, 0.7, 0.1, 1)",
        }}
      />
    </div>
  );
}

function MiniMap({ layout, me, onJump }: { layout: WingLayout[]; me: { x: number; z: number; yaw: number; zone: { kind: string; index?: number } }; onJump: (to: "hub" | number) => void }) {
  // World → map: centred on the rotunda, scaled so the longest wing fits.
  const reach = HUB_R + Math.max(...layout.map((w) => w.length));
  const S = 64 / reach;
  const pt = (x: number, z: number) => [x * S, z * S] as const;
  const [px, pz] = pt(me.x, me.z);
  return (
    <svg viewBox="-70 -70 140 140" className="absolute bottom-4 left-4 h-28 w-28 sm:h-36 sm:w-36" role="img" aria-label="Floor plan">
      <circle cx={0} cy={0} r={68} fill="#0b0e15" fillOpacity={0.72} stroke="#2a3040" />
      {layout.map((w, i) => {
        const deg = (-w.angle * 180) / Math.PI;
        return (
          <g key={w.wing.id} transform={`rotate(${deg})`} className="cursor-pointer" onClick={() => onJump(i)}>
            <title>{w.wing.name}</title>
            <rect
              x={-3.5 * S}
              y={-(HUB_R + w.length) * S}
              width={7 * S}
              height={w.length * S}
              rx={1.5}
              fill={w.wing.color}
              fillOpacity={me.zone.kind === "wing" && me.zone.index === i ? 0.55 : w.items.length ? 0.24 : 0.08}
              stroke={w.wing.color}
              strokeOpacity={me.zone.kind === "wing" && me.zone.index === i ? 1 : 0.6}
              strokeWidth={me.zone.kind === "wing" && me.zone.index === i ? 1.4 : 0.8}
            />
          </g>
        );
      })}
      <circle cx={0} cy={0} r={HUB_R * S} fill="#f2c46d" fillOpacity={0.14} stroke="#f2c46d" strokeOpacity={0.7} strokeWidth={0.8} className="cursor-pointer" onClick={() => onJump("hub")}>
        <title>Rotunda</title>
      </circle>
      {/* You: a soft pulse where you stand, and an arrow for where you face */}
      <circle cx={px} cy={pz} r={5} fill="#eef1f6" fillOpacity={0.25} pointerEvents="none" className="palace-you" />
      <g transform={`translate(${px} ${pz}) rotate(${(-me.yaw * 180) / Math.PI})`} pointerEvents="none">
        <path d="M0 -6 L4 4 L0 2 L-4 4 Z" fill="#eef1f6" />
      </g>
    </svg>
  );
}
