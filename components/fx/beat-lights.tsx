"use client";

import { useEffect, useState } from "react";
import { useVoiceActions } from "@/components/voice/provider";
import * as beat from "@/lib/beat";
import { colorFromWords } from "@/lib/beat-color";
import { FX_EVENT } from "@/lib/client-api";

/**
 * Music lights: while a song plays, the screen's edges and the panels' borders glow with the bass
 * (globals.css reads --beat under html.music-live), and a bass drop flashes the screen once.
 * Click-through, off for reduced motion, and "music lights off" turns it off.
 */
export function BeatLights() {
  const [flash, setFlash] = useState(0);
  useEffect(() => beat.onDrop(() => setFlash((n) => n + 1)), []);
  // "Music lights off" typed in chat (screen_effects tool).
  useEffect(() => {
    const fx = (e: Event) => {
      const d = (e as CustomEvent<{ effect: string; on: boolean; color?: string }>).detail;
      if (d?.effect !== "music_lights" && d?.effect !== "lights") return;
      if (d.color) beat.setColor(d.color);
      beat.setLights(!!d.on);
    };
    window.addEventListener(FX_EVENT, fx);
    return () => window.removeEventListener(FX_EVENT, fx);
  }, []);

  useVoiceActions({
    music_lights: {
      description: "Music lights: the app glowing and pulsing with the beat of the song that's playing (bass drops flash the screen; the galaxy core and the pet pulse too). input: 'on', 'off', or a colour for the lights ('blue', 'pink', 'red', 'green', 'purple', 'white', '#ff00aa', 'rainbow', or 'auto' = the song's cover colour).",
      run: ({ input }) => {
        const said = String(input ?? "");
        const c = colorFromWords(said);
        if (c) {
          beat.setColor(c);
          beat.setLights(true);
          return { music_lights_colour: c };
        }
        const on = !/\boff\b|stop|disable|no\b/i.test(said);
        beat.setLights(on);
        return { music_lights: on ? "on (from the next song or when the music resumes)" : "off" };
      },
    },
  });

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[26]">
      <div className="beat-edge absolute inset-0" />
      {flash > 0 && <div key={flash} className="beat-flash absolute inset-0" />}
    </div>
  );
}
