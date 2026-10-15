"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useVoice, useVoiceActions } from "@/components/voice/provider";
import { type Chatter, isJealous, JEALOUS, MAKE_UP, pickChatter, THUNDER_JUMP } from "@/lib/pet-talk";
import { type Sky, SKY_EVENT, THUNDER_EVENT } from "@/lib/sky";
import { petSay, petVoiceOn, setPetVoice } from "./talk";
import { ASKED_EVENT, FX_EVENT, MUSIC_STATE_EVENT } from "@/lib/client-api";
import type { Pet } from "@/lib/pet";
import { type AccessoryId, accessoryFor, type Festival, festivalById, festivalOn } from "@/lib/pet-looks";
import { judgeGuess } from "@/lib/pet-seek";
import { PetCard } from "./card";
import { Creature } from "./creature";
import { between, clamp, dayNow, GLOW, home, hourNow, type Look, pick, type Pos, reserve, SIZE, type Spot, store } from "./shared";
import { coversControl, hidingSpot, PEEK_CLIP } from "./space";
import * as beat from "@/lib/beat";
import { sfx } from "@/lib/sfx";

/**
 * Nova (a little glowing lantern) lives on the screen and grows with the owner. The server
 * says how it's doing (stage, growth, hungry / sulking / missed you); the browser adds what's
 * happening right now: it dances while music plays, gets sleepy after midnight, chomps when a habit
 * gets done, and bursts into its next form when it evolves. It wanders around the screen on its
 * own (or stays put when asked), and plays hide and seek: it hides behind something on the page,
 * peeking out, and the owner finds it by voice ("is it near the weather?", "top left?") or a tap.
 */
type Seek = { phase: "counting" | "hidden"; spot?: Spot; guesses: number };
/** Lantern walk: the screen goes dark, the pet follows the pointer and its light finds hidden sparks. */
type Walk = { sparks: (Pos & { got: boolean })[]; ends: number };
const SPARKS = 7;
const WALK_MS = 75_000;
const LIGHT = 130;
const POLL_MS = 5 * 60_000;
const FLY_MS = 3200;
const POS_KEY = "hm-pet-xy";
const MODE_KEY = "hm-pet-mode";
const HIDE_KEY = "hm-pet-hidden";
const STAGE_KEY = "hm-pet-stage";
const ROAM_LINES = ["Enna panreenga? 👀", "Inga konjam suthi paakaren ✨", "Bore adikudhu… vilayadalama? 🙈", "Naan inga irukken!", "Hmm hmm 🎵"];
const FEST_KEY = "hm-pet-festival";
const SAID_KEY = "hm-pet-said";
/** What the pet already said today (so it doesn't repeat itself). */
function saidToday(): string[] {
  try {
    const s = JSON.parse(localStorage.getItem(SAID_KEY) ?? "{}") as { day?: string; ids?: string[] };
    return s.day === dayNow() ? (s.ids ?? []) : [];
  } catch {
    return [];
  }
}
function rememberSaid(id: string) {
  try {
    localStorage.setItem(SAID_KEY, JSON.stringify({ day: dayNow(), ids: [...saidToday(), id].slice(-20) }));
  } catch {}
}
/** What a spoken festival name means ("show your Diwali look"). */
const FEST_WORDS: [RegExp, Festival["id"]][] = [
  [/deepavali|diwali|deewali/i, "deepavali"],
  [/karthigai|karthikai|deepam/i, "karthigai"],
  [/pongal|sankranti/i, "pongal"],
  [/puthandu|tamil new year|chithirai/i, "puthandu"],
  [/christmas|xmas|santa/i, "christmas"],
  [/new year/i, "newyear"],
  [/independence|republic|india|flag/i, "india"],
];

export function Nova() {
  const [pet, setPet] = useState<Pet | null>(null);
  const [music, setMusic] = useState(false);
  // Asked to dance (by voice or tap) with no music on: a short dance on its own.
  const [party, setParty] = useState(false);
  // Music lights: a counter bumped on every beat of the song, so the pet bounces in time.
  const [kick, setKick] = useState(0);
  const [hour, setHour] = useState(12);
  const [today, setToday] = useState("");
  // "Show me your Diwali look": that festival's outfit for a little while, whatever the date.
  const [preview, setPreview] = useState<Festival | null>(null);
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
  // The living sky outside (umbrella in the rain, shades in the sun), and a jump at thunder.
  const [sky, setSky] = useState<Sky>("calm");
  const [startled, setStartled] = useState(false);
  // A question it asked, waiting for a tap on one of its replies.
  const [ask, setAsk] = useState<Chatter | null>(null);
  // Jealous for a moment (it pouts until the owner gives it some attention).
  const [pout, setPout] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const voice = useVoice();
  const liveOn = useRef(false);
  useEffect(() => {
    liveOn.current = voice.on;
  }, [voice.on]);
  // Jealousy bookkeeping: HIVEMIND questions since the owner last paid the pet any attention.
  const asks = useRef(0);
  const lastTouch = useRef(0);
  const lastJealous = useRef(0);
  const poutRef = useRef(false);
  const self = useRef<HTMLDivElement>(null);
  const lastFed = useRef<number | null>(null);
  const drag = useRef<{ x: number; y: number; from: Pos; moved: boolean } | null>(null);
  const sayTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const posRef = useRef<Pos | null>(null);
  useEffect(() => {
    posRef.current = pos;
  }, [pos]);

  // Whether a speech bubble is up right now (thunder doesn't talk over it).
  const saying = useRef(false);
  const speak = useCallback((text: string, ms = 3500, talk = true, asked = false) => {
    clearTimeout(sayTimer.current);
    setSay(text);
    saying.current = true;
    sayTimer.current = setTimeout(() => {
      setSay(null);
      saying.current = false;
    }, ms);
    // Out loud too, in its own little voice. In a live conversation it stays quiet unless the owner
    // asked it directly ("Nova, tell me a joke"); then it answers just after HIVEMIND's short "over to Nova".
    if (!talk) return;
    if (!liveOn.current) petSay(text);
    else if (asked) setTimeout(() => petSay(text), 2200);
  }, []);
  /** Says a line asked for by voice, even in a live conversation. */
  const answer = useCallback((text: string, ms = 6500) => speak(text, ms, true, true), [speak]);
  /** The owner paid it attention: no longer ignored (and a pout is forgiven). */
  const touched = useCallback(() => {
    lastTouch.current = Date.now();
    asks.current = 0;
    if (!poutRef.current) return;
    poutRef.current = false;
    setPout(false);
    setTimeout(() => speak(MAKE_UP[Math.floor(Math.random() * MAKE_UP.length)], 3500), 300);
  }, [speak]);
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
    // Its default corner can land on a button (it floats above the page): once the page has drawn,
    // nudge it to the nearest free spot. A spot the owner dragged it to is left alone.
    if (!(stays && saved)) {
      // Checked twice: once the page has drawn, and again after slow pages (the home page builds for a few seconds).
      const nudge = () => {
        const here = posRef.current ?? home();
        if (!coversControl(here, self.current)) return;
        for (let up = 1; up <= 8; up++)
          for (const dx of [0, -70, -140]) {
            const p = clamp({ x: here.x + dx, y: here.y - up * 55 });
            if (!coversControl(p, self.current)) return setPos(p);
          }
      };
      setTimeout(nudge, 1500);
      setTimeout(nudge, 7000);
    }
    setHidden(store.get(HIDE_KEY) === "1");
    setHour(hourNow());
    setToday(dayNow());
    const t = setInterval(() => {
      setHour(hourNow());
      setToday(dayNow());
    }, 60_000);
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the saved voice choice, read once
    setVoiceOn(petVoiceOn());
    // The living sky (components/fx/living-sky.tsx) says what the weather is doing.
    setSky(window.__hmSky ?? "calm");
    const onSky = (e: Event) => setSky((e as CustomEvent<{ sky: Sky }>).detail?.sky ?? "calm");
    window.addEventListener(SKY_EVENT, onSky);
    return () => {
      window.removeEventListener(MUSIC_STATE_EVENT, on);
      window.removeEventListener(SKY_EVENT, onSky);
    };
  }, []);

  // Bounces on the beat while music plays (lib/beat.ts listens to the song).
  useEffect(() => {
    if (!music) return;
    return beat.onBeat(() => setKick((n) => n + 1));
  }, [music]);

  // "Nova, be quiet" typed in chat (screen_effects tool, pet_voice).
  useEffect(() => {
    const fx = (e: Event) => {
      const d = (e as CustomEvent<{ effect: string; on: boolean }>).detail;
      if (d?.effect !== "pet_voice") return;
      setPetVoice(!!d.on);
      setVoiceOn(!!d.on);
    };
    window.addEventListener(FX_EVENT, fx);
    return () => window.removeEventListener(FX_EVENT, fx);
  }, []);

  // Thunder: it jumps.
  useEffect(() => {
    const boom = () => {
      setStartled(true);
      setTimeout(() => setStartled(false), 1400);
      // It always jumps, but only cries out if it isn't already saying something (a greeting, a result).
      if (!saying.current) speak(THUNDER_JUMP[Math.floor(Math.random() * THUNDER_JUMP.length)], 2200);
    };
    window.addEventListener(THUNDER_EVENT, boom);
    return () => window.removeEventListener(THUNDER_EVENT, boom);
  }, [speak]);

  // Every question to HIVEMIND (spoken or typed) while the pet is ignored counts toward jealousy.
  const { subscribe } = voice;
  useEffect(() => {
    const asked = () => void asks.current++;
    window.addEventListener(ASKED_EVENT, asked);
    const off = subscribe({ onTurnEnd: (interrupted) => !interrupted && asked() });
    return () => {
      window.removeEventListener(ASKED_EVENT, asked);
      off();
    };
  }, [subscribe]);

  // On its own now and then (every 7-13 min while the app is open): a question, a joke, a weather
  // line, or, if the owner keeps talking only to HIVEMIND, a jealous pout.
  const quiet = !pet || open || !!seek || !!walk || hidden || !!ask || hour < 5;
  useEffect(() => {
    if (quiet) return;
    const first = lastTouch.current === 0 && asks.current === 0;
    const t = setTimeout(
      () => {
        if (document.visibilityState !== "visible" || liveOn.current) return;
        const now = Date.now();
        if (isJealous({ asks: asks.current, sinceTouchMs: now - (lastTouch.current || now - 3_600_000), sinceJealousMs: now - lastJealous.current })) {
          lastJealous.current = now;
          asks.current = 0;
          poutRef.current = true;
          setPout(true);
          speak(JEALOUS[Math.floor(Math.random() * JEALOUS.length)].say, 6000);
          return;
        }
        const said = saidToday();
        const c = pickChatter({ hour: new Date().getHours(), sky: window.__hmSky ?? "calm", said });
        rememberSaid(c.id);
        hop();
        if (c.replies?.length) {
          setAsk(c);
          if (!liveOn.current) petSay(c.say);
        } else speak(c.say, 6500);
      },
      // The first one comes a couple of minutes after opening the app; then every 7-13 minutes.
      first ? between(100_000, 180_000) : between(420_000, 780_000),
    );
    return () => clearTimeout(t);
  }, [quiet, speak, hop, ask, say]);

  // An unanswered question goes away after a while.
  useEffect(() => {
    if (!ask) return;
    const t = setTimeout(() => setAsk(null), 30_000);
    return () => clearTimeout(t);
  }, [ask]);

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
    // Only where the light can reach and the eye can see: not under the tab bar / music bar at the bottom.
    for (let tries = 0; sparks.length < SPARKS && tries < 400; tries++) {
      const p = { x: between(36, W - 36), y: between(70, H - reserve() - 24), got: false };
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
      // Celebrate at once; the growth it earned is added when the server has counted the walk.
      speak("Ellam kandupidichitom! ✨", 6000);
      const r = await fetch("/api/pet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ walk: true }) }).catch(() => null);
      const data = r?.ok ? await r.json().catch(() => null) : null;
      if (data?.pet) setPet(data.pet);
      if (data?.counted) speak(`Ellam kandupidichitom! ✨ +${data.xp} growth`, 4500, false);
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
      // A finger would hide the lantern: on touch it floats a little above the fingertip.
      const lift = e.pointerType === "touch" ? 70 : 0;
      // Anywhere on screen during the walk (the usual clamp keeps it off the bottom bars, out of reach of sparks).
      const to = {
        x: Math.min(window.innerWidth - SIZE / 2, Math.max(-SIZE / 2, e.clientX - SIZE / 2)),
        y: Math.min(window.innerHeight - SIZE / 2, Math.max(-SIZE / 2, e.clientY - SIZE / 2 - lift)),
      };
      setPos(to);
      const w = walkRef.current;
      if (!w) return;
      const reach = e.pointerType === "touch" ? 70 : 60;
      const found = w.sparks.filter((s) => !s.got && Math.hypot(s.x - (to.x + SIZE / 2), s.y - (to.y + SIZE / 2)) < reach);
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

  const mood: Look = music || party ? "dancing" : sleepy ? "sleepy" : pout ? "sulking" : (pet?.mood ?? "happy");
  const festival = preview ?? (today ? festivalOn(today) : null);
  const line = evolving
    ? `Naan ippo ${pet?.stageName}! ✨`
    : eating !== null
      ? "Nom nom! Thanks da 😋"
      : music
        ? "Indha paattu semma! 🎶"
        : sleepy
          ? "Zzz… romba late aachu, poi thoongu da 😴"
          : festival && mood === "happy"
            ? festival.line
            : (pet?.line ?? "");

  // On a festival day it greets the owner once, the first time they open the app.
  const festId = festival && !preview ? festival.id : null;
  useEffect(() => {
    if (!festId || !pet || store.get(FEST_KEY) === `${today}:${festId}`) return;
    store.set(FEST_KEY, `${today}:${festId}`);
    const f = festivalById(festId);
    if (f) setTimeout(() => speak(f.line, 6000), 1500);
  }, [festId, today, pet, speak]);

  const wearIt = useCallback(async (w: AccessoryId | "none") => {
    const r = await fetch("/api/pet", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wear: w }) }).catch(() => null);
    const data = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok) return { error: (data as { error?: string }).error ?? "Couldn't put it on." };
    if ((data as { pet?: Pet }).pet) setPet((data as { pet: Pet }).pet);
    return { ok: true };
  }, []);

  // Any voice command to the pet counts as paying it attention (touched() in each).
  useVoiceActions({
    nova_status: {
      description: "The owner's pocket pet (a little lantern that lives on the screen; default name Nova, they may have renamed it): how it is, its stage, how fed it is today and how close it is to evolving. Also opens its card.",
      run: () => {
        touched();
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
        touched();
        if (!pet) return { error: "Nova is still waking up." };
        startSeek();
        return { started: true, note: "Tell the owner to close their eyes and count; Nova is hiding. Then they guess where it is (near a card or heading, or 'top left', 'bottom right'…)." };
      },
    },
    nova_guess: {
      description: "A guess in hide and seek: where the owner thinks Nova is hiding, in their words ('near the weather card', 'behind routines', 'top left', 'bottom'). input: the guess, or 'give up'.",
      run: ({ input }) => {
        touched();
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
        touched();
        const t = String(input ?? "").toLowerCase();
        // "Stay here" / "wander around" first: "here" alone must not mean "come".
        const stay = /stay|stop|still|irundhu|anga/.test(t) && !/roam|wander|move around|suthu/.test(t);
        const wander = /roam|wander|move around|suthu|free/.test(t);
        if (!stay && !wander) {
          // "Come", "come here", "where are you", or anything else: fly to the middle of the screen.
          const to = clamp({ x: window.innerWidth / 2 - SIZE / 2, y: window.innerHeight / 2 - SIZE / 2 });
          flyTo(to, pos);
          setTimeout(() => speak("Vandhuten! 👋"), FLY_MS);
          return { came: true };
        }
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
        touched();
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
      description: "Lantern walk with the pet: the screen goes dark, the pet follows the owner's pointer / finger like a lantern and they hunt for hidden sparks in its light (all found = growth points). input: 'start' ('Nova, lights off', 'lantern walk', 'spark hunt') or 'stop' ('Nova, lights on', 'stop the walk'). A plain 'lights off' is the screen effects (music_lights / living_weather), not this.",
      run: ({ input }) => {
        touched();
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
        touched();
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
          answer("Let's goooo! 💃🎶", 3000);
          return { dancing: true };
        }
        if (/hi|hello|vanakkam|hey/.test(t)) {
          answer(`Vanakkam! 👋 Naan ${pet.name}!`, 3000);
          return { said: "hello" };
        }
        if (/sleep|nap|thoongu|rest/.test(t)) {
          answer("Konjam thoonguren… 😴", 3000);
          return { napping: true };
        }
        answer("Hehe 🥰 innum pannu!", 3000);
        return { reaction: "loved it" };
      },
    },
    nova_wear: {
      description: "Dress the pet: input an accessory it has unlocked ('bow', 'malli garland', 'shades', or 'none' to take it off), or a festival to preview that look for a while ('Diwali', 'Karthigai Deepam', 'Pongal', 'Tamil New Year', 'Christmas', 'New Year', 'Independence Day'). Festival looks also appear on their own on those days.",
      run: async ({ input }) => {
        touched();
        if (!pet) return { error: "The pet is still waking up." };
        const said = String(input ?? "");
        const fest = FEST_WORDS.find(([re]) => re.test(said));
        if (fest) {
          const f = festivalById(fest[1]);
          setPreview(f);
          setTimeout(() => setPreview(null), 20_000);
          hop();
          if (f) speak(f.line, 4000);
          return { previewing: f?.name, seconds: 20 };
        }
        const w = accessoryFor(said);
        if (!w) return { error: "Say bow, garland, shades or none (or a festival to preview its look).", unlocked: pet.unlocked };
        const r = await wearIt(w);
        if ("error" in r) return { ...r, unlocked: pet.unlocked, note: "Accessories unlock as it grows: bow at Baby, garland at Glowing, shades at Crowned." };
        hop();
        speak(w === "none" ? "Simple-ah irukken 🙂" : "Eppadi irukku? 😎", 3000);
        return { wearing: w };
      },
    },
    nova_hide: {
      description: "Put Nova away (it shrinks to a small glowing dot) or bring it back. input: 'hide' or 'show'.",
      run: ({ input }) => {
        touched();
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
    nova_talk: {
      description: "The pet's own little voice and chatter: input 'joke' (tell one now), 'talk' / 'ask me something' (a question now), 'quiet' / 'mute' (stop speaking out loud, bubbles stay), 'voice on' (speak again).",
      run: ({ input }) => {
        touched();
        const t = String(input ?? "").toLowerCase();
        if (/quiet|mute|silent|stop talking|shut/.test(t)) {
          setPetVoice(false);
          setVoiceOn(false);
          speak("Sari, amaidhiya irukken 🤐", 3000, false);
          return { voice: "off" };
        }
        if (/voice on|speak|unmute|talk again|pesu/.test(t) && !/joke|ask|question/.test(t)) {
          setPetVoice(true);
          setVoiceOn(true);
          answer("Yay! Ippo pesalaam 🥳", 3000);
          return { voice: "on" };
        }
        const said = saidToday();
        const c = /joke|funny|sirippu/.test(t)
          ? (pickChatter({ hour: 11, sky: "calm", said: [...said, "mood", "song", "water", "walk", "game", "work"] }) ?? null)
          : pickChatter({ hour: new Date().getHours(), sky, said });
        rememberSaid(c.id);
        hop();
        if (c.replies?.length) {
          setAsk(c);
          if (liveOn.current) setTimeout(() => petSay(c.say), 2200);
          else petSay(c.say);
        } else answer(c.say);
        return {
          said: c.say,
          ...(c.replies ? { replies: c.replies.map((r) => r.label) } : {}),
          note: `${pet?.name ?? "Nova"} says this out loud in its own voice. Reply with at most three words (like "Over to ${pet?.name ?? "Nova"}!"); don't repeat it, tell your own joke or answer for it.`,
        };
      },
    },
  });

  if (!pos || !pet) return null;

  const onDown = (e: React.PointerEvent) => {
    // During a lantern walk the walk itself moves it (a touch on the pet must not drag it or open its card).
    if (walk) return;
    touched();
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
  // The side with more room (the bottom bars don't count as room).
  const roomBelow = window.innerHeight - reserve() - (pos.y + SIZE) - 12;
  const roomAbove = pos.y - 12;
  const below = roomBelow > roomAbove;
  const place = below ? "top-full mt-2" : "bottom-full mb-2";
  const shift = (w: number) => ({ left: Math.min(window.innerWidth - w - 8, Math.max(8, pos.x + SIZE / 2 - w / 2)) - pos.x });
  // Phones: the card is a sheet above the tab bar (beside a 88px pet there's never room for it).
  const sheet = window.innerWidth < 640;
  const cardAt = sheet ? {} : { ...shift(288), maxHeight: Math.max(220, Math.min(480, below ? roomBelow : roomAbove)) };
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
          <div className="pointer-events-none fixed left-1/2 top-4 z-[31] flex -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-[#0b1016]/90 py-1 pl-4 pr-1 font-mono text-xs whitespace-nowrap text-fg">
            🏮 {walk.sparks.filter((s) => s.got).length}/{walk.sparks.length} sparks · {left}s
            {/* Phones have no Esc key. */}
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => void endWalk(false, walk.sparks.filter((s) => s.got).length, walk.sparks.length)}
              className="pointer-events-auto rounded-full border border-line px-3 py-1 hover:border-line-strong"
            >
              Stop
            </button>
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
          at={cardAt}
          sheet={sheet}
          roam={roam}
          onRoam={() => {
            const next = !roam;
            setRoam(next);
            store.set(MODE_KEY, next ? null : "stay");
            if (!next) store.set(POS_KEY, JSON.stringify(pos));
          }}
          onSeek={startSeek}
          onWalk={startWalk}
          voiceOn={voiceOn}
          onVoice={() => {
            const next = !voiceOn;
            setPetVoice(next);
            setVoiceOn(next);
            if (next) speak("Yay! Ippo pesalaam 🥳", 3000);
          }}
          festival={festival}
          onWear={(w) => void wearIt(w)}
          onClose={() => setOpen(false)}
          onHide={() => {
            setHidden(true);
            setOpen(false);
            store.set(HIDE_KEY, "1");
          }}
        />
      )}
      {/* A question it asked: tap an answer (it replies, out loud). */}
      {ask && !peeking && !open && (
        <div className={`absolute ${place} z-10 flex w-60 justify-center`} style={shift(240)}>
          <div className="pet-pop w-full rounded-xl border border-line bg-[#0b1016]/95 p-2.5 text-xs text-fg shadow-lg">
            <p>{ask.say}</p>
            <div className="mt-2 flex gap-1.5">
              {ask.replies?.map((r) => (
                <button
                  key={r.label}
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    setAsk(null);
                    touched();
                    hop();
                    answer(r.answer, 5000);
                    if (/Kannai moodunga/.test(r.answer)) setTimeout(startSeek, 1200);
                  }}
                  className="flex-1 rounded-lg border border-line px-2 py-1.5 hover:border-line-strong"
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {bubble && !peeking && !ask && (
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
        <Creature stage={pet.stage} mood={mood} look={facing} eating={eating !== null} evolving={evolving} poked={poked} quiet={!!peeking} festival={festival} wear={pet.wear} sky={sky} startled={startled} kick={kick} />
      </div>
    </div>
    </>
  );
}
