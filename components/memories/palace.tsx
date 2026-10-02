"use client";

import { Home, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Scramble } from "@/components/bridge/scramble";
import { useVoiceActions } from "@/components/voice/provider";
import { HUB_R, WINGS, type PalaceItem, type PalaceScene, type WingLayout, type Zone } from "./palace-scene";

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
};

const KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight"]);

/** The Memory Palace: a walkable 3D museum of the owner's memories (Memory page "Palace" view). */
export function Palace({ items, highlight, openId, related, onOpen, onClose }: Props) {
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
        });
      } catch (err) {
        console.error("palace failed", err);
        setFailed(true);
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

  if (failed) return <p className="border border-line p-6 text-sm text-soft">3D isn&apos;t available on this device. Switch to List view.</p>;

  return (
    <div ref={wrap} className="palace relative h-[70dvh] min-h-[420px] sm:h-[calc(100dvh-20rem)] w-full overflow-hidden border border-line bg-[#06080d]" onPointerDown={() => setHint(false)}>
      <canvas ref={canvas} className="block h-full w-full outline-none" aria-label="Memory Palace: walk through your memories. Use List view for a text list." />

      {/* Where am I: the meta line decodes, the name rises out of a mask, the tagline follows. */}
      <div key={zoneWing?.id ?? "hub"} className="pointer-events-none absolute left-4 top-4 max-w-[60%]">
        <p className="font-mono text-[10px] tracking-[0.25em]" style={{ color: zoneWing?.color ?? "#f2c46d" }}>
          <Scramble text={`${zoneWing ? "WING" : "ROTUNDA"} · ${zoneCount} ${zoneCount === 1 ? "MEMORY" : "MEMORIES"}`} />
        </p>
        <p className="mt-1 overflow-hidden text-lg font-medium tracking-wide text-fg">
          <span className="palace-rise block">{zoneWing?.name ?? "Memory Palace"}</span>
        </p>
        <p className="palace-follow text-[12px] text-soft">{zoneWing?.tagline ?? "Your most important memories stand here. Each doorway leads to a wing."}</p>
      </div>

      {me.zone.kind === "wing" && (
        <button type="button" onClick={() => jump("hub")} className="absolute right-4 top-4 flex items-center gap-1.5 border border-line bg-[#0b0e15]/80 px-2.5 py-1.5 font-mono text-[10.5px] tracking-widest text-soft backdrop-blur hover:border-core hover:text-core">
          <Home size={12} /> ROTUNDA
        </button>
      )}

      {/* Search matches */}
      {highlight && (
        <div className="absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-2 border border-data/40 bg-[#0b0e15]/85 px-3 py-1.5 font-mono text-[11px] text-data backdrop-blur">
          <Search size={12} />
          {matches ? `${matches} lit up` : "No matches here"}
          {matches > 0 && (
            <button type="button" onClick={() => scene.current?.focus(highlight[0])} className="ml-1 border-l border-data/30 pl-2 text-fg hover:text-core">
              GO TO FIRST →
            </button>
          )}
        </div>
      )}

      {/* Floor plan: tap a wing to go there */}
      {layout.length > 0 && <MiniMap layout={layout} me={me} onJump={jump} />}

      {hint && (
        <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center pl-36 pr-4 sm:pl-44">
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

function MiniMap({ layout, me, onJump }: { layout: WingLayout[]; me: { x: number; z: number; yaw: number }; onJump: (to: "hub" | number) => void }) {
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
            <rect x={-3.5 * S} y={-(HUB_R + w.length) * S} width={7 * S} height={w.length * S} fill={w.wing.color} fillOpacity={w.items.length ? 0.28 : 0.1} stroke={w.wing.color} strokeOpacity={0.7} strokeWidth={0.8} />
          </g>
        );
      })}
      <circle cx={0} cy={0} r={HUB_R * S} fill="#f2c46d" fillOpacity={0.14} stroke="#f2c46d" strokeOpacity={0.7} strokeWidth={0.8} className="cursor-pointer" onClick={() => onJump("hub")}>
        <title>Rotunda</title>
      </circle>
      {/* You */}
      <g transform={`translate(${px} ${pz}) rotate(${(-me.yaw * 180) / Math.PI})`} pointerEvents="none">
        <path d="M0 -6 L4 4 L0 2 L-4 4 Z" fill="#eef1f6" />
      </g>
    </svg>
  );
}
