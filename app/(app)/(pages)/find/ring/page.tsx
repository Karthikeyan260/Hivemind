"use client";

import { Flashlight, Volume2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

/**
 * Opened from the "here I am" notification: a loud two-tone siren, buzzing, and the torch flashing,
 * until "Found it". Browsers only make sound after a tap, so if the siren can't start by itself the
 * whole screen is one big button.
 */
export default function RingPage() {
  const [ringing, setRinging] = useState(false);
  const [torch, setTorch] = useState<"off" | "on" | "none">("off");
  const ctx = useRef<AudioContext | null>(null);
  const stopAll = useRef<() => void>(() => {});

  function start() {
    if (ringing) return;
    const ac = new AudioContext();
    ctx.current = ac;
    const gain = ac.createGain();
    gain.gain.value = 0.9;
    gain.connect(ac.destination);
    const osc = ac.createOscillator();
    osc.type = "square";
    osc.connect(gain);
    // A siren: two tones alternating, like an alarm.
    let hi = false;
    const swap = setInterval(() => {
      hi = !hi;
      osc.frequency.setValueAtTime(hi ? 1320 : 880, ac.currentTime);
    }, 350);
    osc.start();
    void ac.resume();
    const buzz = setInterval(() => navigator.vibrate?.([600, 200, 600]), 1600);
    navigator.vibrate?.([600, 200, 600]);
    stopAll.current = () => {
      clearInterval(swap);
      clearInterval(buzz);
      navigator.vibrate?.(0);
      try {
        osc.stop();
      } catch {}
      void ac.close();
    };
    setRinging(true);
    void flash();
  }

  // The torch blinks (Android Chrome can switch the camera light; elsewhere it's skipped).
  const cam = useRef<MediaStreamTrack | null>(null);
  async function flash() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      const track = stream.getVideoTracks()[0];
      const caps = (track.getCapabilities?.() ?? {}) as { torch?: boolean };
      if (!caps.torch) {
        track.stop();
        setTorch("none");
        return;
      }
      cam.current = track;
      let on = false;
      const blink = setInterval(() => {
        on = !on;
        void track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] }).catch(() => {});
      }, 400);
      setTorch("on");
      const prev = stopAll.current;
      stopAll.current = () => {
        prev();
        clearInterval(blink);
        track.stop();
      };
    } catch {
      setTorch("none");
    }
  }

  function stop() {
    stopAll.current();
    setRinging(false);
    setTorch("off");
  }

  useEffect(() => {
    // Try straight away (works when the browser allows it), else the screen asks for a tap.
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the alarm starts as soon as the page opens
      start();
    } catch {}
    return () => stopAll.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`fixed inset-0 z-[70] flex flex-col items-center justify-center gap-6 p-6 text-center ${ringing ? "bg-[#7f1d1d]" : "bg-[#0b1016]"}`}>
      {/* Only the red behind flashes; the screen itself stays solid over the app. */}
      {ringing && <div className="absolute inset-0 -z-10 animate-pulse bg-alert" aria-hidden />}
      <div className="relative text-6xl">📱</div>
      <h1 className="text-3xl font-black text-white">Here I am!</h1>
      {ringing ? (
        <>
          <p className="text-white/90">Ringing{torch === "on" ? " and flashing" : ""}…</p>
          <button type="button" onClick={stop} className="rounded-full bg-white px-10 py-5 text-2xl font-black text-black shadow-2xl">
            Found it
          </button>
        </>
      ) : (
        <button type="button" onClick={start} className="flex items-center gap-3 rounded-full bg-alert px-10 py-5 text-2xl font-black text-white shadow-2xl">
          <Volume2 size={28} /> Tap to ring
        </button>
      )}
      {torch === "none" && ringing && (
        <p className="flex items-center gap-1 text-xs text-white/70">
          <Flashlight size={12} /> This browser can&apos;t use the torch.
        </p>
      )}
      <Link href="/find" className="text-sm text-white/70 underline">
        Find my devices
      </Link>
    </div>
  );
}
