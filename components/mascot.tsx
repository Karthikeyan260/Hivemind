"use client";

import { type CSSProperties, useEffect, useRef, useState } from "react";
import { useVoice } from "@/components/voice/provider";

/**
 * HIVEMIND's face: a chibi of the owner (drawn from their photo; two 3x3 sprite sheets, see the
 * page-mascot skill) that reacts to the live voice. It looks at the pointer on a laptop, pays
 * attention while listening, looks up while thinking, moves its mouth with the voice while
 * speaking, and dozes off when nothing has happened for a while. Swapping frames only moves a
 * background-position, so it costs nothing per frame.
 */
const SHEETS = { directions: "/mascots/karthik-directions.webp", reactions: "/mascots/karthik-reactions.webp" };

const DIRECTIONS = ["up-left", "up", "up-right", "left", "center", "right", "down-left", "down", "down-right"] as const;
const REACTIONS = ["blink", "heart", "sparkle", "surprised", "starstruck", "bashful", "sleepy", "dizzy", "delighted"] as const;
type Direction = (typeof DIRECTIONS)[number];
type Reaction = (typeof REACTIONS)[number];

// Clockwise from the right, matching atan2 with y pointing down.
const CLOCKWISE: Direction[] = ["right", "down-right", "down", "down-left", "left", "up-left", "up", "up-right"];
const SECTOR = (Math.PI * 2) / CLOCKWISE.length;
const DEAD_ZONE = 70;
const DOZE_MS = 90_000;

const cell = (i: number): CSSProperties => ({ backgroundPosition: `${(i % 3) * 50}% ${Math.floor(i / 3) * 50}%` });
const layer: CSSProperties = { position: "absolute", inset: 0, backgroundSize: "300% 300%", backgroundRepeat: "no-repeat" };
const SQUASH: Keyframe[] = [
  { transform: "scale(1, 1)", easing: "ease-in" },
  { transform: "scale(1.10, 0.86)", offset: 0.18, easing: "ease-out" },
  { transform: "scale(0.95, 1.08)", offset: 0.45, easing: "ease-in-out" },
  { transform: "scale(1, 1)" },
];

/** The owner's mascot, alive with the voice. Put it inside a button if tapping should do something. */
export function VoiceMascot({ size = 140, className, onBoop }: { size?: number; className?: string; onBoop?: () => void }) {
  const voice = useVoice();
  const { state, error } = voice;
  const box = useRef<HTMLSpanElement>(null);
  const squash = useRef<HTMLSpanElement>(null);
  const [look, setLook] = useState<Direction>("center");
  const [mouth, setMouth] = useState(false);
  const [boop, setBoop] = useState<Reaction | null>(null);
  const [dozing, setDozing] = useState(false);
  const [thinkSide, setThinkSide] = useState(false);

  // Laptop: follow the pointer (phones have none; the head stays facing you).
  useEffect(() => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const move = (e: PointerEvent) => {
      const b = box.current?.getBoundingClientRect();
      if (!b) return;
      const dx = e.clientX - (b.left + b.width / 2);
      const dy = e.clientY - (b.top + b.height / 2);
      if (Math.hypot(dx, dy) < DEAD_ZONE) return setLook("center");
      setLook(CLOCKWISE[(Math.round(Math.atan2(dy, dx) / SECTOR) + CLOCKWISE.length) % CLOCKWISE.length]);
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, []);

  // Speaking: the mouth opens and closes with how loud HIVEMIND is right now.
  useEffect(() => {
    if (state !== "speaking") return;
    let raf = 0;
    let open = false;
    let last = 0;
    const tick = (t: number) => {
      if (t - last > 90) {
        last = t;
        const next = voice.level() > 0.12;
        if (next !== open) setMouth((open = next));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      setMouth(false);
    };
  }, [state, voice]);

  // Thinking: glance up one way, then the other.
  useEffect(() => {
    if (state !== "thinking") return;
    const t = setInterval(() => setThinkSide((s) => !s), 1100);
    return () => clearInterval(t);
  }, [state]);

  // Nothing happening for a while: doze off (any voice activity or a tap wakes it).
  useEffect(() => {
    if (state !== "off") return;
    const t = setTimeout(() => setDozing(true), DOZE_MS);
    return () => {
      clearTimeout(t);
      setDozing(false);
    };
  }, [state, boop]);

  function tap() {
    setDozing(false);
    setBoop("heart");
    setTimeout(() => setBoop(null), 650);
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) squash.current?.animate(SQUASH, { duration: 420, easing: "linear" });
    onBoop?.();
  }

  // What the face shows right now: a tap first, then the voice state, then where the pointer is.
  const reaction: Reaction | null =
    boop ??
    (error && state === "off" ? "dizzy" : null) ??
    (state === "speaking" ? (mouth ? "delighted" : "blink") : state === "connecting" ? "sparkle" : state === "off" && dozing ? "sleepy" : null);
  const direction: Direction = state === "thinking" ? (thinkSide ? "up-left" : "up-right") : state === "listening" ? "center" : look;

  return (
    <span
      ref={box}
      onClick={tap}
      role="img"
      aria-label={`HIVEMIND (${state === "off" ? "resting" : state})`}
      className={className}
      style={{ position: "relative", display: "block", flexShrink: 0, width: size, height: size, cursor: "pointer", userSelect: "none" }}
    >
      <span ref={squash} style={{ position: "relative", display: "block", width: "100%", height: "100%", transformOrigin: "50% 78%" }}>
        <span style={{ ...layer, backgroundImage: `url(${SHEETS.directions})`, ...cell(DIRECTIONS.indexOf(direction)), opacity: reaction ? 0 : 1 }} />
        {/* Always mounted, so the sheet is loaded before the first reaction. */}
        <span style={{ ...layer, backgroundImage: `url(${SHEETS.reactions})`, ...cell(REACTIONS.indexOf(reaction ?? "blink")), opacity: reaction ? 1 : 0 }} />
      </span>
    </span>
  );
}
