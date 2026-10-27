"use client";

import { Flag } from "lucide-react";
import { useEffect, useState } from "react";
import { Creature } from "@/components/pet/creature";
import { cx } from "@/components/ui";
import { HUES } from "@/lib/guest-pet";
import type { Party } from "@/lib/games/party";
import { MIN_RACERS, TRACK, type RaceView } from "@/lib/games/pet-race";
import type { AccessoryId } from "@/lib/pet-looks";

/**
 * The pet race, between games: everyone's pet runs along a lane; tap BOOST as fast as you can for your own pet.
 * The owner starts it; their browser runs it (lib/games/pet-race.ts), so this is only the picture and the button.
 * The winner gets a crown for the night.
 */
export function PetRace({ party }: { party: Party }) {
  const [race, setRace] = useState<RaceView | null>(null);
  const { on } = party.race;
  useEffect(() => on(setRace), [on]);
  const host = party.role === "host";
  const racers = party.players.filter((p) => p.pet && (p.online || p.host));
  const crowned = party.players.filter((p) => p.crowns);

  if (!race) {
    // Nothing running: the owner can start one; everyone sees the crowns won so far.
    if (!host && !crowned.length) return null;
    return (
      <section className="rounded-2xl border border-line bg-panel p-4" aria-label="Pet race">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-faint">Pet race</h3>
          {crowned.length > 0 && <span className="truncate text-xs text-amber-200">{crowned.map((p) => `${p.pet?.name ?? p.name} 👑${p.crowns}`).join(" · ")}</span>}
        </div>
        {host && (
          <>
            <button type="button" disabled={racers.length < MIN_RACERS} onClick={() => party.race.start()} className="mt-2.5 inline-flex items-center gap-2 rounded-full bg-core px-5 py-2 text-sm font-bold text-core-ink disabled:opacity-40">
              <Flag size={15} /> Start a pet race
            </button>
            <p className="mt-2 text-xs text-soft">{racers.length < MIN_RACERS ? "Needs two pets at the table. A friend can hatch one in the lobby." : "Everyone's pet runs; tap BOOST for yours. The winner gets a crown."}</p>
          </>
        )}
      </section>
    );
  }

  const nameOf = (id: string) => party.players.find((p) => p.id === id)?.pet?.name ?? "A pet";
  const mine = race.lanes.some((l) => l.id === party.me);
  const done = race.phase === "done";
  return (
    <section className="rounded-2xl border border-amber-300/40 bg-panel p-4" aria-label="Pet race">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-amber-200">🏁 Pet race</h3>
        {race.phase === "count" && <span className="text-sm font-bold text-amber-200">{race.left}…</span>}
        {race.phase === "run" && <span className="text-xs text-soft">Tap BOOST!</span>}
      </div>
      <div className="mt-3 space-y-2">
        {race.lanes.map((l) => {
          const pal = party.players.find((p) => p.id === l.id);
          const pet = pal?.pet;
          if (!pet) return null;
          return (
            <div key={l.id} className={cx("relative h-11 overflow-hidden rounded-xl border bg-raised", l.id === party.me ? "border-core/60" : "border-line")}>
              <div className="absolute inset-y-0 right-0 w-1.5 bg-[repeating-linear-gradient(0deg,#fff_0_6px,#111_6px_12px)] opacity-70" />
              <span className="absolute top-1 left-2 z-10 max-w-[40%] truncate text-[10px] font-semibold text-white/60">{pet.name}
                {done && race.winner === l.id ? " 👑" : ""}
              </span>
              <div className="absolute top-0.5 size-10 transition-[left] duration-150 ease-linear" style={{ left: `calc((100% - 44px) * ${l.p / TRACK})` }}>
                <div className={cx("h-full w-full", race.phase === "run" && "roam-bob")} style={{ filter: `hue-rotate(${HUES[pet.hue]?.rotate ?? 0}deg)` }}>
                  <Creature stage={pet.stage} mood="happy" look={{ x: 0, y: 0 }} eating={false} evolving={false} poked={false} wear={(pet.wear as AccessoryId | null) ?? null} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {mine && !done && (
        <button
          type="button"
          disabled={race.phase !== "run"}
          onPointerDown={(e) => {
            e.preventDefault();
            party.race.boost();
          }}
          className="mt-3 w-full touch-manipulation rounded-2xl bg-amber-300 py-4 text-lg font-extrabold tracking-wide text-black select-none active:scale-95 disabled:opacity-40"
        >
          {race.phase === "count" ? "Get ready…" : "BOOST! ⚡"}
        </button>
      )}
      {!mine && !done && <p className="mt-3 text-center text-xs text-soft">Cheer from the sidelines: send a reaction 😀</p>}
      {done && race.winner && <p className="pet-pop mt-3 text-center text-sm font-semibold text-amber-200">🏆 {nameOf(race.winner)} wins{race.winner === party.me ? ", that's yours!" : "!"} 👑 +1 crown</p>}
    </section>
  );
}
