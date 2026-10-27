"use client";

import { Flower2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Creature } from "@/components/pet/creature";
import { cx } from "@/components/ui";
import { cleanGuestName, HUES } from "@/lib/guest-pet";
import type { Party, PartyPet } from "@/lib/games/party";
import { GIFT_GAP_MS } from "@/lib/games/party-rules";
import { ACCESSORIES, type AccessoryId } from "@/lib/pet-looks";
import { STAGES } from "@/lib/pet-stages";

/**
 * Pet pals: at game night every player's pet stands in the lobby next to their name. Pets wave when their
 * owner arrives; tap one to compare growth, what it wears and its best firefly score, and send it a
 * flower. The owner's pet is Nova; a friend's is a guest pet made on their own phone (lib/guest-pet.ts).
 * What is shown of a pet is only what the table was told (see PartyPet), already checked on arrival.
 */
const hueFilter = (hue: number) => ({ filter: `hue-rotate(${HUES[hue]?.rotate ?? 0}deg)` });

/** A small pet next to a player's name (used in the bar above a running game). */
export function MiniPet({ pet }: { pet: PartyPet }) {
  return (
    <span className="relative -my-1 block size-7 shrink-0" title={`${pet.name} (${STAGES[pet.stage]?.name ?? ""})`}>
      <span className="absolute inset-0 overflow-hidden rounded-full" style={hueFilter(pet.hue)}>
        <Creature stage={pet.stage} mood="happy" look={{ x: 0, y: 0 }} eating={false} evolving={false} poked={false} wear={(pet.wear as AccessoryId | null) ?? null} />
      </span>
    </span>
  );
}

/** What a guest does here: make their pet, or play with the one they have. */
export type GuestControls = {
  /** Make the pet (name and colour). */
  hatch: (name: string, hue: number) => void;
  /** Open the firefly game for it. */
  fireflies: () => void;
  /** A flower arrived a moment ago (shows a small note). */
  gotFlower: boolean;
};

export function PetPals({ party, guest, mine }: { party: Party; guest?: GuestControls; /** This player's own pet as this device knows it (shown at once, even before the table has heard of it). */ mine?: PartyPet | null }) {
  // Everyone's pets as the table knows them, with this player's own first (it counts even while still joining).
  const known = party.players.filter((p) => (p.online || p.host) && p.pet);
  const pals = mine && !known.some((p) => p.id === party.me) ? [{ id: party.me, name: "you", online: true, pet: mine }, ...known] : known;
  const [open, setOpen] = useState<string | null>(null);
  // The pet that just got a flower (a flower floats up from it for a moment).
  const [bloom, setBloom] = useState<string | null>(null);
  const [hint, setHint] = useState("");
  const lastFlower = useRef(0);
  const picked = pals.find((p) => p.id === open) ?? null;
  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(""), 2600);
    return () => clearTimeout(t);
  }, [hint]);
  // A guest with no pet yet gets the "make one" card first.
  const needsPet = party.role === "guest" && !mine && !!guest;
  if (!pals.length && !needsPet) return null;

  function flower(id: string) {
    // The table drops flowers sent too fast; say so here instead of sending one that goes nowhere.
    if (Date.now() - lastFlower.current < GIFT_GAP_MS) return setHint("Wait a moment before the next flower.");
    const ok = party.gift(id);
    if (ok) lastFlower.current = Date.now();
    if (ok) {
      setBloom(id);
      setTimeout(() => setBloom((b) => (b === id ? null : b)), 1700);
    }
    setHint(ok ? "🌸 Flower sent!" : "Couldn't send it right now. Try again in a moment.");
  }

  return (
    <section className="rounded-2xl border border-line bg-panel p-4" aria-label="Pet pals">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-faint">Pet pals</h3>
        {guest?.gotFlower && <span className="rounded-full bg-amber-300/15 px-2.5 py-0.5 text-[11px] text-amber-200">🌸 You got a flower!</span>}
      </div>

      {party.role === "guest" && mine && !party.live && (
        <p className="mb-3 rounded-lg bg-amber-300/10 px-3 py-2 text-xs text-amber-200">Your pet is made, but you haven&apos;t reached the table yet, so nobody else can see it. It shows up for everyone as soon as you&apos;re in.</p>
      )}
      {needsPet && guest && <Hatch onHatch={guest.hatch} />}

      {pals.length > 0 && (
        <div className="flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none]">
          {pals.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setOpen(open === p.id ? null : p.id)}
              aria-pressed={open === p.id}
              className={cx("group flex w-24 shrink-0 flex-col items-center rounded-2xl border px-2 pt-1 pb-2 transition", open === p.id ? "border-core bg-core/10" : "border-line/60 hover:border-line-strong")}
            >
              <span className="pal-wave relative block size-20" style={{ animationDelay: `${i * 0.18}s` }}>
                <span className="absolute inset-0" style={hueFilter(p.pet!.hue)}>
                  <Creature stage={p.pet!.stage} mood="happy" look={{ x: 0, y: 0 }} eating={false} evolving={false} poked={false} wear={(p.pet!.wear as AccessoryId | null) ?? null} />
                </span>
                {bloom === p.id && <span className="pal-flower absolute -top-1 right-1 text-lg">🌸</span>}
              </span>
              <span className="mt-0.5 max-w-full truncate text-xs font-semibold">{p.pet!.name}</span>
              <span className="max-w-full truncate text-[10px] text-faint">{p.id === party.me ? "yours" : p.name}</span>
            </button>
          ))}
        </div>
      )}

      {picked?.pet && <Card pal={picked.pet} owner={picked.name} mine={picked.id === party.me} onFlower={() => flower(picked.id)} />}
      {hint && <p className="mt-2 text-xs text-soft">{hint}</p>}

      {mine && guest && party.role === "guest" && (
        <button type="button" onClick={guest.fireflies} className="mt-3 w-full rounded-xl border border-line px-3 py-2 text-xs font-medium hover:border-line-strong">
          ✨ Catch fireflies with {mine.name}
          {mine.best > 0 ? ` · best ${mine.best}` : ""}
        </button>
      )}
    </section>
  );
}

/** One pet's card: how far it has grown, what it wears, its best firefly score, its flowers. */
function Card({ pal, owner, mine, onFlower }: { pal: PartyPet; owner: string; mine: boolean; onFlower: () => void }) {
  const stage = STAGES[pal.stage] ?? STAGES[0];
  const next = STAGES[pal.stage + 1];
  const pct = next ? Math.max(0, Math.min(1, (pal.xp - stage.at) / (next.at - stage.at))) : 1;
  const worn = ACCESSORIES.find((a) => a.id === pal.wear);
  return (
    <div className="pet-pop mt-3 rounded-xl border border-line bg-raised p-3 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <b className="truncate">{pal.name}</b>
        <span className="shrink-0 text-xs text-soft">
          {stage.name} · {mine ? "yours" : `${owner}'s`}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10" aria-label={`${Math.round(pct * 100)}% to the next stage`}>
        <div className="h-full rounded-full bg-amber-300" style={{ width: `${pct * 100}%` }} />
      </div>
      <dl className="mt-2.5 grid grid-cols-3 gap-2 text-center text-xs">
        <div>
          <dt className="text-faint">Growth</dt>
          <dd className="font-semibold tabular-nums">{pal.xp}</dd>
        </div>
        <div>
          <dt className="text-faint">Fireflies</dt>
          <dd className="font-semibold tabular-nums">{pal.best || "–"}</dd>
        </div>
        <div>
          <dt className="text-faint">Flowers</dt>
          <dd className="font-semibold tabular-nums">🌸 {pal.flowers}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-soft">{worn ? `Wearing the ${worn.name.toLowerCase()} ${worn.emoji}` : "Not wearing anything yet"}</p>
      {!mine && (
        <button type="button" onClick={onFlower} className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-amber-300/40 bg-amber-300/10 px-3.5 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-300/20">
          <Flower2 size={13} /> Send a flower
        </button>
      )}
    </div>
  );
}

/** A friend makes their pet: a name and one of six colours. */
function Hatch({ onHatch }: { onHatch: (name: string, hue: number) => void }) {
  const [name, setName] = useState("");
  const [hue, setHue] = useState(0);
  const ok = !!cleanGuestName(name);
  // The egg wobbles for a moment, then the pet pops out and is saved.
  const [hatching, setHatching] = useState(false);
  useEffect(() => {
    if (!hatching) return;
    const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const t = setTimeout(() => onHatch(name, hue), reduced ? 0 : 1900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hatching]);
  if (hatching)
    return (
      <div className="mb-3 grid place-items-center rounded-xl border border-dashed border-core/50 bg-core/5 p-5" role="status" aria-label="Hatching">
        <div className="relative grid size-24 place-items-center">
          <span className="egg-wobble text-6xl">🥚</span>
          <span className="egg-flash pointer-events-none absolute inset-0 rounded-full bg-amber-200/70 blur-xl" />
          <span className="egg-pop absolute inset-0 grid place-items-center text-6xl opacity-0">🐣</span>
        </div>
        <p className="mt-2 text-xs text-soft">Something is hatching…</p>
      </div>
    );
  return (
    <div className="mb-3 rounded-xl border border-dashed border-core/50 bg-core/5 p-3">
      <p className="text-sm font-medium">Get a pet for game night 🥚</p>
      <p className="mt-0.5 text-xs text-soft">It lives on this phone and grows every time you play here.</p>
      <div className="mt-2.5 flex flex-col gap-2.5">
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={16} placeholder="Its name" aria-label="Pet's name" className="w-full min-w-0 rounded-lg border border-line bg-transparent px-3 py-2 text-sm outline-none focus:border-core" />
        <div className="flex gap-1.5" role="radiogroup" aria-label="Colour">
          {HUES.map((h, i) => (
            <button key={h.name} type="button" role="radio" aria-checked={hue === i} aria-label={h.name} onClick={() => setHue(i)} className={cx("size-6 rounded-full border-2 transition", hue === i ? "scale-110 border-white" : "border-transparent opacity-70")} style={{ background: `hsl(${(45 + h.rotate) % 360} 90% 58%)` }} />
          ))}
        </div>
      </div>
      <button type="button" disabled={!ok} onClick={() => setHatching(true)} className="mt-2.5 rounded-full bg-core px-5 py-1.5 text-xs font-bold text-core-ink disabled:opacity-40">
        Hatch it
      </button>
    </div>
  );
}
