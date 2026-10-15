"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useVoiceActions } from "@/components/voice/provider";
import { MUSIC_STATE_EVENT } from "@/lib/client-api";
import type { Pet } from "@/lib/pet";
import { judgeGuess } from "@/lib/pet-seek";
import { sfx } from "@/lib/sfx";

/**
 * Nova (a little glowing lantern) lives on the screen and grows with the owner. The server
 * says how it's doing (stage, growth, hungry / sulking / missed you); the browser adds what's
 * happening right now: it dances while music plays, gets sleepy after midnight, chomps when a habit
 * gets done, and bursts into its next form when it evolves. It wanders around the screen on its
 * own (or stays put when asked), and plays hide and seek: it hides behind something on the page,
 * peeking out, and the owner finds it by voice ("is it near the weather?", "top left?") or a tap.
 */
type Look = "happy" | "hungry" | "sulking" | "missed" | "sleepy" | "dancing";
type Pos = { x: number; y: number };
type Spot = Pos & { name: string; row: "top" | "middle" | "bottom"; col: "left" | "center" | "right"; peek: "top" | "left" | "right" };
type Seek = { phase: "counting" | "hidden"; spot?: Spot; guesses: number };
/** Lantern walk: the screen goes dark, the pet follows the pointer and its light finds hidden sparks. */
type Walk = { sparks: (Pos & { got: boolean })[]; ends: number };
const SPARKS = 7;
const WALK_MS = 75_000;
const LIGHT = 130;

const GLOW: Record<Look, string> = {
  happy: "#ffd166",
  hungry: "#ffa94d",
  sulking: "#8a96a3",
  missed: "#ff8fab",
  sleepy: "#74c0fc",
  dancing: "#c3fae8",
};
const SIZE = 88;
const POLL_MS = 5 * 60_000;
const FLY_MS = 3200;
const POS_KEY = "hm-pet-xy";
const MODE_KEY = "hm-pet-mode";
const HIDE_KEY = "hm-pet-hidden";
const STAGE_KEY = "hm-pet-stage";
const ROAM_LINES = ["Enna panreenga? 👀", "Inga konjam suthi paakaren ✨", "Bore adikudhu… vilayadalama? 🙈", "Naan inga irukken!", "Hmm hmm 🎵"];
// How a peek is clipped: only the part sticking out from behind the thing it hides behind shows.
const PEEK_CLIP: Record<Spot["peek"], string> = { top: "inset(0 0 40% 0)", left: "inset(0 50% 0 0)", right: "inset(0 0 0 50%)" };

const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string | null) {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {}
  },
};

const hourNow = () => new Date().getHours();
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
const between = (a: number, b: number) => a + Math.random() * (b - a);
/** Room left at the bottom for the tab bar and the music bar. */
const reserve = () => (window.innerWidth < 768 ? 150 : 90);
const clamp = (p: Pos): Pos => ({
  x: Math.min(window.innerWidth - SIZE - 8, Math.max(8, p.x)),
  y: Math.min(window.innerHeight - SIZE - reserve(), Math.max(8, p.y)),
});
const home = (): Pos => clamp({ x: window.innerWidth - SIZE - 16, y: window.innerHeight - SIZE - reserve() - 60 });

/** What a page element is called, for guesses like "near the weather card". */
function labelOf(el: Element) {
  const own = el.getAttribute("aria-label") || el.getAttribute("title") || el.querySelector("h1, h2, h3, h4, [class*='uppercase']")?.textContent || (el as HTMLElement).innerText || "";
  return own.replace(/\s+/g, " ").trim().slice(0, 40);
}

/** Somewhere on screen to hide: next to a real card, button or heading, peeking out from its edge. */
function hidingSpot(self: Element | null): Spot | null {
  const W = window.innerWidth;
  const H = window.innerHeight - reserve();
  const options = [...document.querySelectorAll("section, aside, header, nav, article, form, button, img, h1, h2, h3, [role=region]")]
    .filter((el) => !self?.contains(el) && !el.closest("[data-pet]") && !floating(el))
    .map((el) => ({ el, r: el.getBoundingClientRect(), name: labelOf(el) }))
    .filter(({ r, name }) => name.length >= 3 && r.width >= 70 && r.height >= 28 && r.top > 40 && r.bottom < H && r.left >= 0 && r.right <= W);
  // Try a few: a spot under a floating panel (a toast, the voice dock) could never be found.
  for (let attempt = 0; attempt < 12 && options.length; attempt++) {
    const spot = spotBy(pick(options));
    if (spot && inTheOpen(spot, self)) return spot;
  }
  return null;
}

/** Would the pet, standing here, cover something clickable or typeable? (Checks its middle and corners.) */
function coversControl(p: Pos, self: Element | null) {
  const points = [
    [0.5, 0.5],
    [0.2, 0.25],
    [0.8, 0.25],
    [0.2, 0.85],
    [0.8, 0.85],
  ];
  return points.some(([fx, fy]) => {
    const hit = document.elementsFromPoint(p.x + SIZE * fx, p.y + SIZE * fy).find((el) => !self?.contains(el) && !el.closest("[data-pet]"));
    return !!hit?.closest("button, a, input, textarea, select, [role=button], [contenteditable=true]");
  });
}

/** Inside something that floats over the page (a toast, the voice dock): it can come and go. */
function floating(hit: Element) {
  const screen = window.innerWidth * window.innerHeight;
  for (let el: Element | null = hit; el; el = el.parentElement) {
    if (getComputedStyle(el).position !== "fixed") continue;
    // A full-screen fixed layout (the home page is one) is the page itself, not something floating over it.
    const r = el.getBoundingClientRect();
    if (r.width * r.height < screen * 0.5) return true;
  }
  return false;
}

/** The part of it that peeks out must not be covered by anything floating (fixed) on the page. */
function inTheOpen(s: Spot, self: Element | null) {
  const vx = s.peek === "left" ? s.x + SIZE * 0.25 : s.peek === "right" ? s.x + SIZE * 0.75 : s.x + SIZE / 2;
  const vy = s.peek === "top" ? s.y + SIZE * 0.3 : s.y + SIZE / 2;
  if (vx < 0 || vy < 0 || vx > window.innerWidth || vy > window.innerHeight) return false;
  return document.elementsFromPoint(vx, vy).filter((el) => !self?.contains(el) && !el.closest("[data-pet]")).slice(0, 1).every((hit) => !floating(hit));
}

function spotBy({ r, name }: { r: DOMRect; name: string }): Spot | null {
  const W = window.innerWidth;
  const H = window.innerHeight - reserve();
  const peek = pick<Spot["peek"]>(["top", "top", "left", "right"]);
  const at =
    peek === "top"
      ? { x: between(r.left, Math.max(r.left, r.right - SIZE)), y: r.top - SIZE * 0.6 }
      : peek === "left"
        ? { x: r.left - SIZE * 0.5, y: between(r.top, Math.max(r.top, r.bottom - SIZE)) }
        : { x: r.right - SIZE * 0.5, y: between(r.top, Math.max(r.top, r.bottom - SIZE)) };
  // Keep the part that peeks out on screen (on a phone a right-edge peek would otherwise end up off it).
  const p = { x: Math.min(W - SIZE - 4, Math.max(4, at.x)), y: Math.min(H - SIZE, Math.max(4, at.y)) };
  const cx = (p.x + SIZE / 2) / W;
  const cy = (p.y + SIZE / 2) / H;
  return { ...p, name, peek, col: cx < 0.36 ? "left" : cx > 0.64 ? "right" : "center", row: cy < 0.36 ? "top" : cy > 0.64 ? "bottom" : "middle" };
}

export function Nova() {
  const [pet, setPet] = useState<Pet | null>(null);
  const [music, setMusic] = useState(false);
  // Asked to dance (by voice or tap) with no music on: a short dance on its own.
  const [party, setParty] = useState(false);
  const [hour, setHour] = useState(12);
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  // Short-lived reactions: chomping after a habit, the evolution burst, a happy hop when poked.
  const [eating, setEating] = useState<number | null>(null);
  const [evolving, setEvolving] = useState(false);
  const [poked, setPoked] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const [flying, setFlying] = useState<null | "left" | "right">(null);
  const [roam, setRoam] = useState(true);
  const [seek, setSeek] = useState<Seek | null>(null);
  const [say, setSay] = useState<string | null>(null);
  const [walk, setWalk] = useState<Walk | null>(null);
  const [clock, setClock] = useState(0);
  const [look, setLookAt] = useState({ x: 0, y: 0 });
  const self = useRef<HTMLDivElement>(null);
  const lastFed = useRef<number | null>(null);
  const drag = useRef<{ x: number; y: number; from: Pos; moved: boolean } | null>(null);
  const sayTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const posRef = useRef<Pos | null>(null);
  useEffect(() => {
    posRef.current = pos;
  }, [pos]);

  const speak = useCallback((text: string, ms = 3500) => {
    clearTimeout(sayTimer.current);
    setSay(text);
    sayTimer.current = setTimeout(() => setSay(null), ms);
  }, []);
  const hop = useCallback(() => {
    setPoked(true);
    setTimeout(() => setPoked(false), 700);
  }, []);
  /** Glides to a spot, its head turned the way it's going. */
  const flyTo = useCallback((to: Pos, from: Pos | null) => {
    clearTimeout(flyTimer.current);
    setFlying(from && to.x < from.x ? "left" : "right");
    setPos(to);
    flyTimer.current = setTimeout(() => setFlying(null), FLY_MS);
  }, []);

  // Where it sat last time, whether it wanders, and whether it was tucked away.
  useEffect(() => {
    const saved = store.get(POS_KEY);
    const stays = store.get(MODE_KEY) === "stay";
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the browser's saved settings once on mount
    setRoam(!stays);
    setPos(stays && saved ? clamp(JSON.parse(saved)) : home());
    setHidden(store.get(HIDE_KEY) === "1");
    setHour(hourNow());
    const t = setInterval(() => setHour(hourNow()), 60_000);
    const fit = () => setPos((p) => (p ? clamp(p) : p));
    window.addEventListener("resize", fit);
    return () => {
      clearInterval(t);
      window.removeEventListener("resize", fit);
    };
  }, []);

  // Its state from the server: on load, every few minutes, and when the owner comes back to the tab.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const r = await fetch("/api/pet").catch(() => null);
      const data = r?.ok ? ((await r.json().catch(() => null)) as { pet?: Pet } | null) : null;
      if (!alive || !data?.pet) return;
      const p = data.pet;
      // A habit got done since the last look: chomp, and show what it earned.
      if (lastFed.current !== null && p.fed.done > lastFed.current) {
        setEating((p.fed.done - lastFed.current) * 10);
        setTimeout(() => setEating(null), 2400);
      }
      lastFed.current = p.fed.done;
      // Grew into its next form since the owner last saw it.
      const seen = Number(store.get(STAGE_KEY) ?? p.stage);
      if (p.stage > seen) {
        setEvolving(true);
        setOpen(true);
        setTimeout(() => setEvolving(false), 3200);
      }
      store.set(STAGE_KEY, String(p.stage));
      setPet(p);
    };
    void load();
    const t = setInterval(load, POLL_MS);
    const onFocus = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  // Dances while the music plays.
  useEffect(() => {
    const on = (e: Event) => setMusic(!!(e as CustomEvent<{ playing: boolean }>).detail?.playing);
    window.addEventListener(MUSIC_STATE_EVENT, on);
    return () => window.removeEventListener(MUSIC_STATE_EVENT, on);
  }, []);

  // Its eyes follow the pointer.
  useEffect(() => {
    let frame = 0;
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = self.current?.getBoundingClientRect();
        if (!box) return;
        const dx = e.clientX - (box.left + box.width / 2);
        const dy = e.clientY - (box.top + box.height / 2);
        const d = Math.max(1, Math.hypot(dx, dy));
        const k = Math.min(1, d / 300) * 2.4;
        setLookAt({ x: (dx / d) * k, y: (dy / d) * k });
      });
    };
    window.addEventListener("pointermove", move);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
    };
  }, []);

  // Wanders: every half a minute or so it glides somewhere new (not while its card is open, during
  // a game, while asleep, or when told to stay).
  const sleepy = hour < 5;
  const busy = open || !!seek || !!walk || hidden || !roam || sleepy || !pet;
  useEffect(() => {
    if (busy) return;
    const t = setTimeout(
      () => {
        if (document.visibilityState !== "visible" || drag.current) return;
        const W = window.innerWidth;
        const H = window.innerHeight - reserve();
        // Somewhere it won't sit on a button, link or text box (it floats above the page and would block it).
        let to = clamp({ x: between(16, W - SIZE - 16), y: between(80, H - SIZE) });
        for (let i = 0; i < 12 && coversControl(to, self.current); i++) to = clamp({ x: between(16, W - SIZE - 16), y: between(80, H - SIZE) });
        if (coversControl(to, self.current)) return;
        flyTo(to, posRef.current);
        if (Math.random() < 0.35) setTimeout(() => speak(pick(ROAM_LINES)), FLY_MS);
      },
      // Sitting on a button or link (e.g. where it first appeared): move off it right away.
      posRef.current && coversControl(posRef.current, self.current) ? 1200 : between(18_000, 38_000),
    );
    return () => clearTimeout(t);
  }, [busy, pos, flyTo, speak]);

  // Hide and seek: while hidden it giggles now and then, as a hint.
  useEffect(() => {
    if (seek?.phase !== "hidden") return;
    const t = setInterval(() => {
      hop();
      speak("hihi 🤭", 1800);
    }, 25_000);
    return () => clearInterval(t);
  }, [seek?.phase, hop, speak]);

  // ---------- lantern walk ----------
  const walkRef = useRef<Walk | null>(null);
  const startWalk = useCallback(() => {
    setOpen(false);
    setSeek(null);
    setHidden(false);
    clearTimeout(flyTimer.current);
    setFlying(null);
    const W = window.innerWidth;
    const H = window.innerHeight;
    const here = posRef.current;
    const sparks: Walk["sparks"] = [];
    // Spread out, not on top of each other and not where the pet already stands.
    for (let tries = 0; sparks.length < SPARKS && tries < 400; tries++) {
      const p = { x: between(40, W - 40), y: between(70, H - 60), got: false };
      if (here && Math.hypot(p.x - (here.x + SIZE / 2), p.y - (here.y + SIZE / 2)) < LIGHT * 1.5) continue;
      if (sparks.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 120)) continue;
      sparks.push(p);
    }
    setClock(Date.now());
    walkRef.current = { sparks, ends: Date.now() + WALK_MS };
    setWalk(walkRef.current);
    speak(`Lights off! 🏮 ${sparks.length} sparks olinjirukku, kandupidi!`, 3500);
  }, [speak]);

  const endWalk = useCallback(
    async (all: boolean, found: number, total: number) => {
      // Once: the timer and the last spark can both end it in the same moment.
      if (!walkRef.current) return;
      walkRef.current = null;
      setWalk(null);
      hop();
      if (!all) return speak(found ? `Time up! ${found}/${total} sparks 🌟 Innoru try?` : "Lights on! 💡", 3500);
      sfx.done();
      const r = await fetch("/api/pet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ walk: true }) }).catch(() => null);
      const data = r?.ok ? await r.json().catch(() => null) : null;
      if (data?.pet) setPet(data.pet);
      speak(data?.counted ? `Ellam kandupidichitom! ✨ +${data.xp} growth` : "Ellam kandupidichitom! ✨ (today's walk points are full)", 4500);
    },
    [hop, speak],
  );

  // During the walk the pet follows the pointer (or a tap / drag on a phone); its light collects sparks.
  useEffect(() => {
    walkRef.current = walk;
  }, [walk]);
  const walking = !!walk;
  useEffect(() => {
    if (!walking) return;
    const follow = (e: PointerEvent) => {
      const to = clamp({ x: e.clientX - SIZE / 2, y: e.clientY - SIZE / 2 });
      setPos(to);
      const w = walkRef.current;
      if (!w) return;
      const found = w.sparks.filter((s) => !s.got && Math.hypot(s.x - (to.x + SIZE / 2), s.y - (to.y + SIZE / 2)) < 60);
      if (!found.length) return;
      sfx.hover();
      const sparks = w.sparks.map((s) => (found.includes(s) ? { ...s, got: true } : s));
      walkRef.current = { ...w, sparks };
      if (sparks.every((s) => s.got)) void endWalk(true, sparks.length, sparks.length);
      else setWalk(walkRef.current);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") void endWalk(false, 0, 0);
    };
    const t = setInterval(() => {
      const w = walkRef.current;
      setClock(Date.now());
      if (w && Date.now() > w.ends) void endWalk(false, w.sparks.filter((s) => s.got).length, w.sparks.length);
    }, 500);
    window.addEventListener("pointermove", follow);
    window.addEventListener("pointerdown", follow);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointermove", follow);
      window.removeEventListener("pointerdown", follow);
      window.removeEventListener("keydown", key);
      clearInterval(t);
    };
  }, [walking, endWalk]);

  const startSeek = useCallback(() => {
    setOpen(false);
    setHidden(false);
    setSeek({ phase: "counting", guesses: 0 });
    speak("Kannai moodunga! 1… 2… 3… 🙈", 2600);
    setTimeout(() => {
      const spot = hidingSpot(self.current);
      if (!spot) {
        setSeek(null);
        speak("Inga olinja idame illa! 😅", 2500);
        return;
      }
      clearTimeout(flyTimer.current);
      setFlying(null);
      setPos({ x: spot.x, y: spot.y });
      setSeek({ phase: "hidden", spot, guesses: 0 });
    }, 2800);
  }, [speak]);

  const found = useCallback(
    (tries: number, gaveUp = false) => {
      setSeek(null);
      hop();
      speak(gaveUp ? "Inga dhaan irundhen! 😜 Innoru round?" : `Kandupidichiteenga! 🎉 ${tries} ${tries === 1 ? "try" : "tries"}`, 4000);
      const p = posRef.current;
      if (p) flyTo(clamp({ x: p.x, y: p.y + 30 }), p);
    },
    [hop, speak, flyTo],
  );

  const mood: Look = music || party ? "dancing" : sleepy ? "sleepy" : (pet?.mood ?? "happy");
  const line = evolving
    ? `Naan ippo ${pet?.stageName}! ✨`
    : eating !== null
      ? "Nom nom! Thanks da 😋"
      : music
        ? "Indha paattu semma! 🎶"
        : sleepy
          ? "Zzz… romba late aachu, poi thoongu da 😴"
          : (pet?.line ?? "");

  useVoiceActions({
    nova_status: {
      description: "The owner's pocket pet (a little lantern that lives on the screen; default name Nova, they may have renamed it): how it is, its stage, how fed it is today and how close it is to evolving. Also opens its card.",
      run: () => {
        if (!pet) return { error: "Nova is still waking up." };
        setHidden(false);
        store.set(HIDE_KEY, null);
        setOpen(true);
        return { name: pet.name, stage: pet.stageName, mood, says: line, fed_today: `${pet.fed.done} of ${pet.fed.due} habits`, growth_to_next_stage: pet.toNext, age_days: pet.days };
      },
    },
    nova_hide_and_seek: {
      description: "Start a game of hide and seek with Nova: it hides somewhere on the screen, peeking out from behind a card, button or heading. The owner then guesses where (use nova_guess).",
      run: () => {
        if (!pet) return { error: "Nova is still waking up." };
        startSeek();
        return { started: true, note: "Tell the owner to close their eyes and count; Nova is hiding. Then they guess where it is (near a card or heading, or 'top left', 'bottom right'…)." };
      },
    },
    nova_guess: {
      description: "A guess in hide and seek: where the owner thinks Nova is hiding, in their words ('near the weather card', 'behind routines', 'top left', 'bottom'). input: the guess, or 'give up'.",
      run: ({ input }) => {
        const said = String(input ?? "");
        if (!seek) return { error: "No game on. Start one with nova_hide_and_seek." };
        if (seek.phase !== "hidden" || !seek.spot) return { note: "Nova is still hiding; wait a second, then guess." };
        const tries = seek.guesses + 1;
        if (/give ?up|surrender|tell me|where are you|mudiyala|theriyala/i.test(said)) {
          const where = `${seek.spot.row} ${seek.spot.col}, near "${seek.spot.name}"`;
          found(tries, true);
          return { gave_up: true, it_was: where };
        }
        const verdict = judgeGuess(said, seek.spot);
        if (verdict === "found") {
          found(tries);
          return { found: true, tries, it_was_near: seek.spot.name };
        }
        setSeek({ ...seek, guesses: tries });
        hop();
        const hint = tries >= 3 ? `Hint: it's somewhere in the ${seek.spot.row} ${seek.spot.col === "center" ? "middle" : seek.spot.col} of the screen.` : undefined;
        speak(verdict === "warm" ? "Kitta vandhuteenga! 🔥" : "Illa illa! ❄️", 2200);
        return { found: false, verdict, tries, ...(hint ? { hint } : {}), note: "Say warm (close) or cold playfully; let them guess again." };
      },
    },
    nova_move: {
      description: "Where Nova goes: input 'stay' (stop wandering, stay where it is), 'roam' (wander around the screen again), or 'come' (fly to the middle of the screen).",
      run: ({ input }) => {
        const t = String(input ?? "").toLowerCase();
        if (/come|here|middle|centre|center|vaa/.test(t)) {
          const to = clamp({ x: window.innerWidth / 2 - SIZE / 2, y: window.innerHeight / 2 - SIZE / 2 });
          flyTo(to, pos);
          setTimeout(() => speak("Vandhuten! 👋"), FLY_MS);
          return { came: true };
        }
        const stay = /stay|stop|still|irundhu|anga/.test(t) && !/roam|wander|move around|suthu/.test(t);
        setRoam(!stay);
        store.set(MODE_KEY, stay ? "stay" : null);
        if (stay && pos) store.set(POS_KEY, JSON.stringify(pos));
        speak(stay ? "Sari, inga dhaan irupen 🙂" : "Yay! Suthi paakaporen ✨", 2500);
        return { wandering: !stay };
      },
    },
    nova_rename: {
      description: "Rename the owner's pet (default name Nova): 'rename my pet to Pixel', 'call it Sparky'. input: just the new name.",
      run: async ({ input }) => {
        const r = await fetch("/api/pet", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: String(input ?? "") }) }).catch(() => null);
        const data = r ? await r.json().catch(() => ({})) : {};
        if (!r?.ok) return { error: data.error ?? "Couldn't rename it." };
        if (data.pet) setPet(data.pet);
        hop();
        speak(`Ini naan ${data.name}! 🥰`, 3500);
        return { renamed_to: data.name };
      },
    },
    nova_lantern_walk: {
      description: "Lantern walk with the pet: the screen goes dark, the pet follows the owner's pointer / finger like a lantern and they hunt for hidden sparks in its light (all found = growth points). input: 'start' ('lights off', 'lantern walk') or 'stop' ('lights on').",
      run: ({ input }) => {
        if (/stop|end|quit|lights on/i.test(String(input ?? ""))) {
          if (walk) void endWalk(false, walk.sparks.filter((s) => s.got).length, walk.sparks.length);
          return { stopped: true };
        }
        if (!pet) return { error: "The pet is still waking up." };
        startWalk();
        return { started: true, sparks: SPARKS, seconds: WALK_MS / 1000, note: "Tell them to move the pointer (or drag a finger) to guide the lantern and find the sparks in the dark." };
      },
    },
    nova_play: {
      description: "Play with the pet or tell it something: input 'pat' (pat / pet / cuddle it), 'dance' (it dances for a bit), 'hi' (it says hello), 'sleep' (it naps a moment), 'close' (close its card), 'open' (open its card).",
      run: ({ input }) => {
        if (!pet) return { error: "The pet is still waking up." };
        const t = String(input ?? "").toLowerCase();
        setHidden(false);
        store.set(HIDE_KEY, null);
        if (/close|shut|mudu/.test(t)) {
          setOpen(false);
          return { card: "closed" };
        }
        if (/open|card|show/.test(t)) {
          setOpen(true);
          return { card: "open" };
        }
        hop();
        if (/danc|aadu|party|groove/.test(t)) {
          setParty(true);
          setTimeout(() => setParty(false), 8000);
          speak("Let's goooo! 💃🎶", 3000);
          return { dancing: true };
        }
        if (/hi|hello|vanakkam|hey/.test(t)) {
          speak(`Vanakkam! 👋 Naan ${pet.name}!`, 3000);
          return { said: "hello" };
        }
        if (/sleep|nap|thoongu|rest/.test(t)) {
          speak("Konjam thoonguren… 😴", 3000);
          return { napping: true };
        }
        speak("Hehe 🥰 innum pannu!", 3000);
        return { reaction: "loved it" };
      },
    },
    nova_hide: {
      description: "Put Nova away (it shrinks to a small glowing dot) or bring it back. input: 'hide' or 'show'.",
      run: ({ input }) => {
        const hide = !/show|back|bring/i.test(String(input ?? ""));
        setHidden(hide);
        store.set(HIDE_KEY, hide ? "1" : null);
        if (hide) {
          setOpen(false);
          setSeek(null);
        }
        return { hidden: hide };
      },
    },
  });

  if (!pos || !pet) return null;

  const onDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, from: pos, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || seek) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 6) return;
    d.moved = true;
    clearTimeout(flyTimer.current);
    setFlying(null);
    setPos(clamp({ x: d.from.x + dx, y: d.from.y + dy }));
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved) {
      store.set(POS_KEY, JSON.stringify(pos));
      return;
    }
    // Tapped while hiding: found it.
    if (seek?.phase === "hidden") return found(seek.guesses + 1);
    if (seek) return;
    setOpen((o) => !o);
    hop();
  };

  // Bubbles and the card open toward the roomy side of the screen.
  // Above or below, whichever half of the screen has room; sideways, centred on the pet but kept on screen.
  const below = pos.y + SIZE / 2 < window.innerHeight / 2;
  const place = below ? "top-full mt-2" : "bottom-full mb-2";
  const shift = (w: number) => ({ left: Math.min(window.innerWidth - w - 8, Math.max(8, pos.x + SIZE / 2 - w / 2)) - pos.x });
  const peeking = seek?.phase === "hidden" ? seek.spot?.peek : undefined;
  const counting = seek?.phase === "counting";
  const bubble = say ?? (eating !== null || evolving || (!open && !seek && (mood === "hungry" || mood === "missed")) ? line : null);
  // While gliding, it looks the way it's going.
  const facing = flying ? { x: flying === "left" ? -2.4 : 2.4, y: 0 } : look;

  if (hidden) {
    return (
      <button
        type="button"
        aria-label={`Bring ${pet.name} back`}
        title={pet.name}
        onClick={() => {
          setHidden(false);
          store.set(HIDE_KEY, null);
        }}
        className="pet-glow fixed z-30 h-3.5 w-3.5 rounded-full"
        style={{ left: pos.x + SIZE / 2, top: pos.y + SIZE / 2, background: GLOW[mood], boxShadow: `0 0 14px 4px ${GLOW[mood]}88` }}
      />
    );
  }

  const left = walk ? Math.max(0, Math.ceil((walk.ends - clock) / 1000)) : 0;
  const light = walk ? { x: pos.x + SIZE / 2, y: pos.y + SIZE / 2 } : null;

  return (
    <>
      {walk && light && (
        <>
          {/* The sparks sit under the dark: only the lantern's light shows them. */}
          <div className="pointer-events-none fixed inset-0 z-[28]">
            {walk.sparks.map((s, i) => (
              <span
                key={i}
                className={s.got ? "pet-burst absolute h-6 w-6 rounded-full" : "pet-glow absolute text-xl leading-none"}
                style={{ left: s.x - 12, top: s.y - 12, ...(s.got ? { border: "2px solid #ffe066" } : { color: "#ffe066", textShadow: "0 0 12px #ffd166" }) }}
              >
                {s.got ? "" : "✦"}
              </span>
            ))}
          </div>
          {/* The dark, with a warm circle of light around the lantern. It catches taps so nothing behind gets clicked. */}
          <div
            className="fixed inset-0 z-[29] touch-none"
            style={{ background: `radial-gradient(circle at ${light.x}px ${light.y}px, rgba(255,209,102,0.12) 0, rgba(255,209,102,0.04) ${LIGHT * 0.7}px, rgba(3,5,9,0.97) ${LIGHT}px)` }}
          />
          <div className="pointer-events-none fixed left-1/2 top-4 z-[31] -translate-x-1/2 rounded-full border border-line bg-[#0b1016]/90 px-4 py-1.5 font-mono text-xs text-fg">
            🏮 {walk.sparks.filter((s) => s.got).length}/{walk.sparks.length} sparks · {left}s · <span className="text-faint">Esc to stop</span>
          </div>
        </>
      )}
    <div
      data-pet
      className="fixed z-30 select-none"
      style={{
        left: pos.x,
        top: pos.y,
        transition: flying ? `left ${FLY_MS}ms cubic-bezier(.45,.05,.35,1), top ${FLY_MS}ms cubic-bezier(.45,.05,.35,1)` : "none",
      }}
    >
      {open && (
        <PetCard
          pet={pet}
          line={line}
          mood={mood}
          place={place}
          at={shift(288)}
          roam={roam}
          onRoam={() => {
            const next = !roam;
            setRoam(next);
            store.set(MODE_KEY, next ? null : "stay");
            if (!next) store.set(POS_KEY, JSON.stringify(pos));
          }}
          onSeek={startSeek}
          onWalk={startWalk}
          onClose={() => setOpen(false)}
          onHide={() => {
            setHidden(true);
            setOpen(false);
            store.set(HIDE_KEY, "1");
          }}
        />
      )}
      {bubble && !peeking && (
        <div className={`pointer-events-none absolute ${place} flex w-56 justify-center`} style={shift(224)}>
          <div className="pet-pop w-max max-w-56 rounded-xl border border-line bg-[#0b1016]/95 px-2.5 py-1.5 text-xs text-fg shadow-lg">{bubble}</div>
        </div>
      )}
      <div
        ref={self}
        role="button"
        tabIndex={0}
        aria-label={peeking ? "Nova is hiding here" : `${pet.name}, your pet: ${line}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (seek?.phase === "hidden" ? found(seek.guesses + 1) : setOpen((o) => !o))}
        className={`relative touch-none ${seek ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"}`}
        style={{
          width: SIZE,
          height: SIZE,
          clipPath: peeking ? PEEK_CLIP[peeking] : undefined,
          opacity: counting ? 0 : 1,
          transform: counting ? "scale(0.4)" : undefined,
          transition: "opacity .5s, transform .5s",
        }}
      >
        {eating !== null && <span className="pet-plus pointer-events-none absolute -top-2 left-1/2 text-sm font-bold text-amber-300">+{eating}</span>}
        <Creature stage={pet.stage} mood={mood} look={facing} eating={eating !== null} evolving={evolving} poked={poked} quiet={!!peeking} />
      </div>
    </div>
    </>
  );
}

function PetCard({ pet, line, mood, place, at, roam, onRoam, onSeek, onWalk, onClose, onHide }: { pet: Pet; line: string; mood: Look; place: string; at: { left: number }; roam: boolean; onRoam: () => void; onSeek: () => void; onWalk: () => void; onClose: () => void; onHide: () => void }) {
  const fedPct = pet.fed.due ? Math.round((pet.fed.done / pet.fed.due) * 100) : 0;
  return (
    <div style={at} className={`pet-pop absolute ${place} max-h-[min(70vh,30rem)] w-72 overflow-y-auto rounded-2xl border border-line bg-[#0b1016]/95 p-4 text-sm text-fg shadow-2xl backdrop-blur-md`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: GLOW[mood] }}>
            ◆ Pocket pet · day {pet.days}
          </p>
          <p className="mt-0.5 text-base font-semibold">{pet.name}</p>
          <p className="text-xs text-faint">{pet.stageName}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-md px-1.5 text-faint hover:text-fg">
          ✕
        </button>
      </div>
      <p className="mt-3 rounded-lg bg-white/5 px-3 py-2 text-[13px] leading-snug">“{line}”</p>

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
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={onSeek} className="rounded-lg border border-line px-2 py-1.5 text-xs hover:border-line-strong">
          🙈 Hide and seek
        </button>
        <button type="button" onClick={onWalk} className="col-span-2 rounded-lg border border-line px-2 py-1.5 text-xs hover:border-line-strong">
          🏮 Lantern walk: find sparks in the dark
        </button>
        <button type="button" onClick={onRoam} className="rounded-lg border border-line px-2 py-1.5 text-xs hover:border-line-strong">
          {roam ? "📍 Stay here" : "✨ Wander around"}
        </button>
      </div>
      <div className="mt-3 flex justify-between text-[11px] text-faint">
        <span>{pet.xp} growth points</span>
        <button type="button" onClick={onHide} className="hover:text-fg">
          Put away
        </button>
      </div>
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
/**
 * The lantern itself: an illustrated chibi (two 3x3 sprite sheets, see the page-mascot skill). One
 * sheet turns its head toward the pointer, the other holds its expressions. It lights up as it
 * grows: an unlit seed, then lit, then fireflies circling it, then a crown of sparks.
 */
const SHEETS = { directions: "/mascots/nova-directions.webp", reactions: "/mascots/nova-reactions.webp" };
const DIRECTIONS = ["up-left", "up", "up-right", "left", "center", "right", "down-left", "down", "down-right"] as const;
const REACTION = { blink: 0, heart: 1, sparkle: 2, surprised: 3, starstruck: 4, bashful: 5, sleepy: 6, dizzy: 7, delighted: 8 } as const;
type Reaction = keyof typeof REACTION;
// Clockwise from the right, matching atan2 with y pointing down.
const CLOCKWISE = ["right", "down-right", "down", "down-left", "left", "up-left", "up", "up-right"] as const;
const cell = (i: number) => ({ backgroundPosition: `${(i % 3) * 50}% ${Math.floor(i / 3) * 50}%`, backgroundSize: "300% 300%", backgroundRepeat: "no-repeat" as const });

function Creature({ stage, mood, look, eating, evolving, poked, quiet = false }: { stage: number; mood: Look; look: { x: number; y: number }; eating: boolean; evolving: boolean; poked: boolean; quiet?: boolean }) {
  const glow = GLOW[mood];
  // A blink every few seconds, and a beat for dancing (star eyes / big grin).
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 450);
    return () => clearInterval(t);
  }, []);
  const blink = tick % 11 === 0;

  const reaction: Reaction | null = evolving
    ? "sparkle"
    : eating
      ? "heart"
      : poked
        ? "delighted"
        : mood === "dancing"
          ? tick % 2
            ? "starstruck"
            : "delighted"
          : mood === "sleepy"
            ? "sleepy"
            : mood === "sulking"
              ? "dizzy"
              : mood === "hungry"
                ? "surprised"
                : mood === "missed"
                  ? tick % 4 < 2
                    ? "surprised"
                    : "heart"
                  : blink
                    ? "blink"
                    : null;
  const mag = Math.hypot(look.x, look.y);
  const dir = mag < 0.6 ? "center" : CLOCKWISE[Math.round(((Math.atan2(look.y, look.x) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8];
  const body = mood === "dancing" ? "pet-dance" : mood === "sleepy" ? "pet-breathe" : mood === "missed" || poked || eating ? "pet-hop" : "pet-float";
  // Grows a little and glows brighter with each stage; the seed is an unlit lantern.
  const scale = [0.78, 0.9, 1, 1.06][stage] ?? 1;
  const lit = stage === 0 ? "saturate(0.55) brightness(0.85)" : mood === "sulking" ? "grayscale(0.75) brightness(0.9)" : "none";
  // Hiding (quiet): no glow or fireflies, they would give it away.
  const aura = quiet ? 0 : mood === "sulking" ? 0.25 : [0.25, 0.5, 0.7, 0.9][stage] ?? 0.7;

  return (
    <div className="relative h-full w-full">
      {/* Aura behind it. */}
      {!quiet && <div className="pet-glow absolute inset-[12%] rounded-full blur-xl" style={{ background: glow, opacity: aura }} />}
      {evolving && <div className="pet-burst absolute inset-[30%] rounded-full border-2" style={{ borderColor: glow }} />}

      {/* Fireflies circling it (stage 3+), more of them at the last stage. */}
      {stage >= 2 && !quiet && (
        <div className="pet-orbit pointer-events-none absolute inset-[-14%]">
          {[...Array(stage >= 3 ? 5 : 3).keys()].map((i, _, a) => (
            <span
              key={i}
              className="pet-glow absolute h-1.5 w-1.5 rounded-full"
              style={{
                left: `${50 + 46 * Math.cos((i / a.length) * Math.PI * 2)}%`,
                top: `${50 + 46 * Math.sin((i / a.length) * Math.PI * 2)}%`,
                background: "#fff3bf",
                boxShadow: `0 0 8px 3px ${glow}`,
                animationDelay: `${i * 0.4}s`,
              }}
            />
          ))}
        </div>
      )}

      <div className={`${body} absolute inset-0`} style={{ transformOrigin: "50% 90%" }}>
        <div className="absolute inset-0" style={{ transform: `scale(${scale})`, transformOrigin: "50% 85%", filter: quiet ? lit : `${lit} drop-shadow(0 0 ${4 + stage * 3}px ${glow}aa)`, transition: "filter 0.6s" }}>
          <div className="absolute inset-0" style={{ backgroundImage: `url(${SHEETS.directions})`, ...cell(DIRECTIONS.indexOf(dir)), opacity: reaction ? 0 : 1 }} />
          <div className="absolute inset-0" style={{ backgroundImage: `url(${SHEETS.reactions})`, ...cell(REACTION[reaction ?? "blink"]), opacity: reaction ? 1 : 0 }} />
        </div>
        {/* Crown of sparks (last stage). */}
        {stage >= 3 && <span className="pet-glow absolute left-1/2 top-[-6%] -translate-x-1/2 text-sm leading-none text-amber-300">✦✧✦</span>}
      </div>

      {/* Mood extras around it. */}
      {mood === "dancing" && (
        <>
          <span className="pet-note absolute left-[2%] top-[18%] text-sm text-teal-200">♪</span>
          <span className="pet-note absolute right-[2%] top-[8%] text-sm text-teal-200" style={{ animationDelay: "0.7s" }}>♫</span>
        </>
      )}
      {mood === "sulking" && (
        <div className="absolute left-1/2 top-[-12%] -translate-x-1/2">
          <span className="block text-lg leading-none">☁️</span>
          <span className="pet-rain absolute left-[30%] top-full h-1.5 w-px bg-sky-300" />
          <span className="pet-rain absolute left-[60%] top-full h-1.5 w-px bg-sky-300" style={{ animationDelay: "0.4s" }} />
        </div>
      )}
      {mood === "hungry" && <span className="absolute right-[-4%] top-[4%] text-base">🍚</span>}
    </div>
  );
}
