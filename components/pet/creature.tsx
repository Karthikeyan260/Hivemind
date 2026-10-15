"use client";

import { useEffect, useState } from "react";
import type { AccessoryId, Festival } from "@/lib/pet-looks";
import type { Sky } from "@/lib/sky";
import { Looks } from "./looks";
import { GLOW, type Look } from "./shared";

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

export function Creature({ stage, mood, look, eating, evolving, poked, quiet = false, festival = null, wear = null, sky = "calm", startled = false }: { stage: number; mood: Look; look: { x: number; y: number }; eating: boolean; evolving: boolean; poked: boolean; quiet?: boolean; festival?: Festival | null; wear?: AccessoryId | null; sky?: Sky; startled?: boolean }) {
  // A festival tints its glow when it's simply happy.
  const glow = festival && mood === "happy" ? festival.glow : GLOW[mood];
  // A blink every few seconds, and a beat for dancing (star eyes / big grin).
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 450);
    return () => clearInterval(t);
  }, []);
  const blink = tick % 11 === 0;

  const reaction: Reaction | null = evolving
    ? "sparkle"
    : startled
      ? "surprised"
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
  const body = mood === "dancing" ? "pet-dance" : mood === "sleepy" ? "pet-breathe" : mood === "missed" || poked || eating || startled ? "pet-hop" : "pet-float";
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
          {!quiet && <Looks festival={festival} wear={wear} sky={sky} />}
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
