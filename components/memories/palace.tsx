"use client";

import { Home, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Scramble } from "@/components/bridge/scramble";
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
  onClose: () => void;
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
      const mod = await import("./palace-scene");
      if (!alive || !canvas.current) return;
      try {
        s = new mod.PalaceScene(canvas.current, items, {
          onOpen: (id) => openRef.current(id),
          onClose: () => closeRef.current(),
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
