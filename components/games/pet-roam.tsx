"use client";

import { useEffect, useRef, useState } from "react";
import { Creature } from "@/components/pet/creature";
import { HUES } from "@/lib/guest-pet";
import type { Party, PartyPet } from "@/lib/games/party";
import type { AccessoryId } from "@/lib/pet-looks";

/**
 * Pets at the game table, alive like Nova on the home screen: each player's pet wanders along the bottom of
 * the screen, hops when its owner sends a reaction, can be dragged (it drops back down), and says something
 * when tapped.
 */
const SIZE = 64;
const LINES = ["Hi hi! 👋", "Yaaay, game time!", "Good luck! 🍀", "Ippo enna game? 🎲", "I'm cheering for you!", "Semma fun! ✨", "Don't forget to smile 😊", "Let's gooo!"];

const rnd = () => Math.random();
type Spot = { x: number; lift: number; face: 1 | -1; moving: boolean; hop: number; say: string };
const fresh = (): Spot => ({ x: 16 + rnd() * 200, lift: 0, face: 1, moving: false, hop: 0, say: "" });

export function PetRoam({ party }: { party: Party }) {
  const pals = party.players.filter((p) => p.pet && (p.online || p.host));
  const [spots, setSpots] = useState<Record<string, Spot>>({});
  const [width, setWidth] = useState(0);
  const [dragId, setDragId] = useState<string | null>(null);
  const drag = useRef<{ id: string; sx: number; sy: number; ox: number; ol: number; moved: boolean } | null>(null);
  const ids = pals.map((p) => p.id).join("|");

  useEffect(() => {
    const on = () => setWidth(window.innerWidth);
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  const patch = (id: string, f: (s: Spot) => Spot) => setSpots((o) => ({ ...o, [id]: f(o[id] ?? fresh()) }));

  // Each pet picks a new place to stroll to every few seconds.
  useEffect(() => {
    if (!width) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let alive = true;
    for (const id of ids.split("|").filter(Boolean)) {
      const go = () => {
        if (!alive) return;
        if (drag.current?.id !== id) {
          const to = 8 + rnd() * Math.max(10, width - SIZE - 16);
          patch(id, (s) => ({ ...s, x: to, face: to >= s.x ? 1 : -1, moving: true }));
          timers.push(setTimeout(() => alive && patch(id, (s) => ({ ...s, moving: false })), 2600));
        }
        timers.push(setTimeout(go, 4500 + rnd() * 5000));
      };
      timers.push(setTimeout(go, 600 + rnd() * 2500));
    }
    return () => {
      alive = false;
      timers.forEach(clearTimeout);
    };
  }, [ids, width]);

  // A pet hops when its owner sends a reaction.
  const { onFloats } = party;
  const seen = useRef(0);
  useEffect(
    () =>
      onFloats((fl) => {
        for (const f of fl) {
          if (f.k <= seen.current) continue;
          seen.current = Math.max(seen.current, f.k);
          if (ids.split("|").includes(f.who)) patch(f.who, (s) => ({ ...s, hop: s.hop + 1 }));
        }
      }),
    [onFloats, ids],
  );

  const speak = (id: string) => {
    patch(id, (s) => ({ ...s, hop: s.hop + 1, say: LINES[Math.floor(rnd() * LINES.length)] }));
    setTimeout(() => patch(id, (s) => ({ ...s, say: "" })), 2400);
  };

  if (!pals.length) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-30 overflow-hidden" aria-label="Pets walking around">
      {pals.map((p) => {
        const pet = p.pet as PartyPet;
        const s = spots[p.id] ?? fresh();
        const dragging = dragId === p.id;
        return (
          <div
            key={p.id}
            className="pointer-events-auto absolute touch-none select-none"
            style={{
              left: s.x,
              bottom: `calc(var(--tabbar-h, 0px) + var(--music-h, 0px) + 20px + ${s.lift}px)`,
              width: SIZE,
              height: SIZE,
              transition: dragging ? "none" : "left 2.6s ease-in-out, bottom 0.35s cubic-bezier(.4,1.6,.5,1)",
              cursor: dragging ? "grabbing" : "grab",
            }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { id: p.id, sx: e.clientX, sy: e.clientY, ox: s.x, ol: s.lift, moved: false };
              setDragId(p.id);
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d || d.id !== p.id) return;
              const dx = e.clientX - d.sx;
              const dy = e.clientY - d.sy;
              if (!d.moved && Math.hypot(dx, dy) < 6) return;
              d.moved = true;
              patch(p.id, (o) => ({ ...o, x: Math.max(0, Math.min(width - SIZE, d.ox + dx)), lift: Math.max(0, d.ol - dy), moving: false }));
            }}
            onPointerUp={() => {
              const d = drag.current;
              drag.current = null;
              setDragId(null);
              if (!d) return;
              if (d.moved) patch(p.id, (o) => ({ ...o, lift: 0, hop: o.hop + 1 }));
              else speak(p.id);
            }}
            role="button"
            aria-label={`${pet.name}, ${p.name}'s pet. Tap to say hi, drag to move.`}
          >
            {s.say && (
              <div className="pet-pop pointer-events-none absolute bottom-full left-1/2 mb-1 w-max max-w-44 -translate-x-1/2 rounded-xl border border-line bg-[#0b1016]/95 px-2.5 py-1.5 text-xs text-fg shadow-lg">
                <b className="mr-1">{pet.name}:</b>
                {s.say}
              </div>
            )}
            <div key={s.hop} className={s.hop ? "roam-hop h-full w-full" : "h-full w-full"}>
              <div className={s.moving ? "roam-bob h-full w-full" : "h-full w-full"} style={{ transform: `scaleX(${s.face})` }}>
                <div className="h-full w-full" style={{ filter: `hue-rotate(${HUES[pet.hue]?.rotate ?? 0}deg)` }}>
                  <Creature stage={pet.stage} mood="happy" look={{ x: 0, y: 0 }} eating={false} evolving={false} poked={false} wear={(pet.wear as AccessoryId | null) ?? null} />
                </div>
              </div>
            </div>
            <span className="pointer-events-none absolute inset-x-0 -bottom-3 truncate text-center text-[10px] font-semibold text-white/80 [text-shadow:0_1px_3px_#000]">{pet.name}
              {p.crowns ? ` 👑${p.crowns}` : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}
