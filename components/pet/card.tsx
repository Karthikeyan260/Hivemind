"use client";

import { useState } from "react";
import type { Pet } from "@/lib/pet";
import { ACCESSORIES, type AccessoryId, type Festival } from "@/lib/pet-looks";
import { GLOW, type Look } from "./shared";

/** The pet's card: how it's doing, what fed it, what it wears, and what to play. */
export function PetCard({ pet, line, mood, place, at, sheet, roam, onRoam, onSeek, onWalk, onFireflies, voiceOn, onVoice, festival, onWear, onClose, onHide }: { pet: Pet; line: string; mood: Look; place: string; at: React.CSSProperties; sheet: boolean; roam: boolean; onRoam: () => void; onSeek: () => void; onWalk: () => void; onFireflies: () => void; voiceOn: boolean; onVoice: () => void; festival: Festival | null; onWear: (w: AccessoryId | "none") => void; onClose: () => void; onHide: () => void }) {
  // The line under the accessories: what was just tapped (how to earn it, or that it is on).
  const [hint, setHint] = useState("");
  const fedPct = pet.fed.due ? Math.round((pet.fed.done / pet.fed.due) * 100) : 0;
  return (
    <div
      style={at}
      className={`pet-pop ${sheet ? "fixed inset-x-2 bottom-[calc(var(--tabbar-h,0px)+var(--music-h,0px)+0.5rem)] z-10 max-h-[70dvh] pb-6" : `absolute ${place} w-72`} overflow-y-auto overscroll-contain rounded-2xl border border-line bg-[#0b1016]/95 p-4 text-sm text-fg shadow-2xl backdrop-blur-md`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: GLOW[mood] }}>
            ◆ Pocket pet · day {pet.days}
          </p>
          <p className="mt-0.5 text-base font-semibold">{pet.name}</p>
          <p className="text-xs text-faint">{pet.stageName}</p>
        </div>
        {/* Up here, not in the bottom corner: on a phone the voice button floats over that corner. */}
        <div className="flex items-center gap-1">
          <button type="button" onClick={onVoice} title={voiceOn ? "Its voice is on: tap to keep it quiet" : "Its voice is off: tap to let it talk"} aria-label={voiceOn ? "Mute its voice" : "Turn its voice on"} className="rounded-md px-1.5 py-1 text-sm text-faint hover:text-fg">
            {voiceOn ? "🔊" : "🔇"}
          </button>
          <button type="button" onClick={onHide} className="rounded-md px-2 py-1 text-[11px] text-faint hover:text-fg">
            Put away
          </button>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md px-1.5 text-faint hover:text-fg">
            ✕
          </button>
        </div>
      </div>
      <p className="mt-3 rounded-lg bg-white/5 px-3 py-2 text-[13px] leading-snug">“{line}”</p>
      <p className={`mt-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-snug ${pet.wish.done ? "border-ok/40 bg-ok/10 text-ok" : "border-amber-300/30 bg-amber-300/5"}`}>
        <span className="text-base leading-none">{pet.wish.done ? "✅" : pet.wish.icon}</span>
        <span>
          <b className="font-mono text-[10px] uppercase tracking-[0.18em] opacity-70">{pet.wish.done ? "Wish granted · +8" : "Nova's wish today"}</b>
          <br />
          {pet.wish.text}
        </span>
      </p>

      <Bar label="Growth" value={pet.progress} color={GLOW[mood]} note={pet.toNext === null ? "Fully grown 👑" : `${pet.toNext} to evolve`} />
      <Bar label="Fed today" value={fedPct / 100} color="#8ce99a" note={pet.fed.due ? `${pet.fed.done} / ${pet.fed.due} habits` : "No habits today: add one to feed it"} />

      <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-faint">Today it got</p>
      {pet.today.length ? (
        <ul className="mt-1 space-y-0.5 text-xs">
          {pet.today.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs text-soft">Nothing yet. Habits, check-ins, game wins, songs and memories feed it.</p>
      )}
      {festival && (
        <p className="mt-3 rounded-lg px-3 py-1.5 text-xs" style={{ background: `${festival.glow}22`, color: festival.glow }}>
          ✨ Today&apos;s look: {festival.name}
        </p>
      )}
      <div className="mt-3 flex items-baseline justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-faint">Wear</p>
        <span className="font-mono text-[10px] text-faint">
          {pet.unlocked.length}/{ACCESSORIES.length} earned
        </span>
      </div>
      <div className="mt-1.5 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
        {[...ACCESSORIES].sort((a, b) => Number(pet.unlocked.includes(b.id)) - Number(pet.unlocked.includes(a.id))).map((a) => {
          const has = pet.unlocked.includes(a.id);
          const on = pet.wear === a.id;
          return (
            <button
              key={a.id}
              type="button"
              aria-label={has ? `${a.name}${on ? " (wearing)" : ""}` : `${a.name}, locked`}
              onClick={() => {
                if (!has) return setHint(`🔒 ${a.name}: ${a.how}`);
                setHint(on ? `Took off the ${a.name.toLowerCase()}` : `Wearing the ${a.name.toLowerCase()}`);
                onWear(on ? "none" : a.id);
              }}
              title={has ? (on ? "Take it off" : `Wear the ${a.name.toLowerCase()}`) : `Earn it: ${a.how}`}
              className={`relative grid size-10 shrink-0 place-items-center rounded-full border text-lg transition ${on ? "border-amber-300 bg-amber-300/20 shadow-[0_0_14px_-2px_rgba(252,211,77,.7)]" : has ? "border-line hover:border-line-strong" : "border-line/60 opacity-45 grayscale"}`}
            >
              {a.emoji}
              {!has && <span className="absolute -right-0.5 -top-0.5 text-[9px] leading-none">🔒</span>}
            </button>
          );
        })}
      </div>
      <p className="mt-1 min-h-4 text-[11px] text-soft">{hint || "Tap one to wear it, or a locked one to see how to earn it."}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={onSeek} className="rounded-lg border border-line px-2 py-1.5 text-xs hover:border-line-strong">
          🙈 Hide and seek
        </button>
        <button type="button" onClick={onRoam} className="rounded-lg border border-line px-2 py-1.5 text-xs hover:border-line-strong">
          {roam ? "📍 Stay here" : "✨ Wander around"}
        </button>
        <button type="button" onClick={onFireflies} className="col-span-2 rounded-lg border border-line px-2 py-1.5 text-xs hover:border-line-strong">
          ✨ Catch fireflies{pet.fireflies.best > 0 ? ` · best ${pet.fireflies.best}` : ""}
        </button>
        <button type="button" onClick={onWalk} className="col-span-2 rounded-lg border border-line px-2 py-1.5 text-xs hover:border-line-strong">
          🏮 Lantern walk: find sparks in the dark
        </button>
        <a href="/garden" className="col-span-2 rounded-lg border border-line px-2 py-1.5 text-center text-xs hover:border-line-strong">
          🌱 {pet.name}&apos;s garden: everything you grew
        </a>
      </div>
      <p className="mt-3 text-[11px] text-faint">{pet.xp} growth points</p>
    </div>
  );
}

function Bar({ label, value, color, note }: { label: string; value: number; color: string; note: string }) {
  return (
    <div className="mt-3">
      <div className="flex justify-between text-[11px] text-faint">
        <span>{label}</span>
        <span>{note}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.round(value * 100)}%`, background: color }} />
      </div>
    </div>
  );
}
