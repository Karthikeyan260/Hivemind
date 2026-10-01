"use client";

import { Grid3x3, Loader2, Mic, MicOff, Phone, PhoneOff, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { isPublicPage } from "@/lib/public-paths";

/** Ask the global call sheet to call a real phone number through HIVEMIND (Twilio). */
export const PSTN_EVENT = "hivemind:phone-call";
export function startPhoneCall(to: string, name?: string) {
  window.dispatchEvent(new CustomEvent(PSTN_EVENT, { detail: { to, name } }));
}
/** Chat/voice actions use "pstn:+91…?name=Arif" links for this. */
export function parsePstn(href: string) {
  const [num, q] = href.replace(/^pstn:/, "").split("?");
  return { to: decodeURIComponent(num), name: new URLSearchParams(q ?? "").get("name") ?? undefined };
}

type Stage = "confirm" | "connecting" | "ringing" | "live" | "ended" | "error";
type TwilioCall = { mute(m: boolean): void; sendDigits(d: string): void; disconnect(): void; on(ev: string, fn: (...a: unknown[]) => void): void };
type TwilioDevice = { connect(o: { params: Record<string, string> }): Promise<TwilioCall>; destroy(): void };

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const pretty = (n: string) => (n.startsWith("+91") && n.length === 13 ? `+91 ${n.slice(3, 8)} ${n.slice(8)}` : n);
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

/**
 * A real phone call from the browser: Twilio rings the number and shows the owner's own verified
 * number as caller ID. Starts from a tap (browsers need one for the mic and the audio).
 */
export function PhoneCallSheet() {
  const path = usePathname();
  const [target, setTarget] = useState<{ to: string; name?: string } | null>(null);
  const [stage, setStage] = useState<Stage>("confirm");
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [keypad, setKeypad] = useState(false);
  const [callerId, setCallerId] = useState("");
  const device = useRef<TwilioDevice | null>(null);
  const call = useRef<TwilioCall | null>(null);

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ to: string; name?: string }>).detail;
      setTarget(d);
      setStage("confirm");
      setError("");
      setSeconds(0);
      setMuted(false);
      setKeypad(false);
    };
    window.addEventListener(PSTN_EVENT, on);
    return () => window.removeEventListener(PSTN_EVENT, on);
  }, []);

  useEffect(() => {
    if (stage !== "live") return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [stage]);

  const cleanup = useCallback(() => {
    call.current?.disconnect();
    device.current?.destroy();
    call.current = device.current = null;
  }, []);
  useEffect(() => cleanup, [cleanup]);

  async function dial() {
    if (!target) return;
    setStage("connecting");
    setError("");
    try {
      const r = await fetch("/api/twilio/token");
      const j = (await r.json()) as { token?: string; callerId?: string; error?: string };
      if (!r.ok || !j.token) throw new Error(j.error || "Couldn't start the call.");
      setCallerId(j.callerId ?? "");
      const { Device } = await import("@twilio/voice-sdk");
      const d = new Device(j.token, { logLevel: "error", codecPreferences: ["opus", "pcmu"] as never }) as unknown as TwilioDevice;
      device.current = d;
      const c = await d.connect({ params: { To: target.to } });
      call.current = c;
      c.on("ringing", () => setStage("ringing"));
      c.on("accept", () => setStage((s) => (s === "connecting" ? "ringing" : s)));
      // With answerOnBridge, "accept" fires on ring; real audio starts when the other side answers.
      c.on("volume", (_in: unknown, out: unknown) => {
        if (Number(out) > 0.01) setStage((s) => (s === "ringing" ? "live" : s));
      });
      c.on("disconnect", () => {
        setStage("ended");
        cleanup();
      });
      c.on("cancel", () => setStage("ended"));
      c.on("reject", () => setStage("ended"));
      c.on("error", (e: unknown) => {
        const msg = (e as { message?: string })?.message ?? "Call failed.";
        setError(/permission|NotAllowed/i.test(msg) ? "Microphone permission is needed for the call." : msg);
        setStage("error");
        cleanup();
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Call failed.");
      setStage("error");
      cleanup();
    }
  }

  function hangup() {
    cleanup();
    setStage("ended");
  }

  if (!target || isPublicPage(path)) return null;
  const who = target.name || pretty(target.to);
  const status: Record<Stage, string> = {
    confirm: "Calls through HIVEMIND from the browser. They see your own number.",
    connecting: "Connecting…",
    ringing: "Ringing…",
    live: fmt(seconds),
    ended: seconds ? `Call ended · ${fmt(seconds)}` : "Call ended",
    error,
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={`Call ${who}`}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="sheet-up relative w-full max-w-sm rounded-t-3xl border border-line bg-sunken px-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-5 text-center sm:rounded-3xl">
        {(stage === "confirm" || stage === "ended" || stage === "error") && (
          <button type="button" onClick={() => setTarget(null)} aria-label="Close" className="absolute right-4 top-4 p-1 text-faint hover:text-fg">
            <X size={18} />
          </button>
        )}
        <div className="font-mono text-[10px] tracking-[0.3em] text-faint">HIVEMIND · PHONE CALL</div>
        <div className={cx("mx-auto mt-5 flex size-20 items-center justify-center rounded-full border-2 text-3xl font-semibold uppercase", stage === "live" ? "border-ok text-ok motion-safe:animate-pulse" : "border-data/40 text-data")}>
          {who.replace(/[^A-Za-z0-9]/g, "").slice(0, 1) || "#"}
        </div>
        <div className="mt-3 text-xl font-semibold">{who}</div>
        {target.name && <div className="font-mono text-[11px] text-soft">{pretty(target.to)}</div>}
        <div className={cx("mt-2 text-sm", stage === "error" ? "text-alert" : "text-soft")}>
          {(stage === "connecting" || stage === "ringing") && <Loader2 size={13} className="mr-1 inline animate-spin" />}
          {status[stage]}
        </div>
        {callerId && stage !== "confirm" && <div className="mt-1 font-mono text-[10px] text-faint">Caller ID {callerId}</div>}

        {keypad && (stage === "live" || stage === "ringing") && (
          <div className="mx-auto mt-4 grid max-w-[13rem] grid-cols-3 gap-2">
            {KEYS.map((k) => (
              <button key={k} type="button" onClick={() => call.current?.sendDigits(k)} className="rounded-full border border-line py-2.5 font-mono text-lg active:bg-raised">
                {k}
              </button>
            ))}
          </div>
        )}

        <div className="mt-6 flex items-center justify-center gap-5">
          {stage === "confirm" || stage === "error" || stage === "ended" ? (
            <button type="button" onClick={dial} aria-label={`Call ${who}`} className="flex size-16 items-center justify-center rounded-full bg-ok text-black">
              <Phone size={26} />
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  call.current?.mute(!muted);
                  setMuted(!muted);
                }}
                aria-pressed={muted}
                aria-label={muted ? "Unmute" : "Mute"}
                className={cx("flex size-12 items-center justify-center rounded-full border", muted ? "border-alert bg-alert/15 text-alert" : "border-line")}
              >
                {muted ? <MicOff size={20} /> : <Mic size={20} />}
              </button>
              <button type="button" onClick={hangup} aria-label="Hang up" className="flex size-16 items-center justify-center rounded-full bg-alert text-white">
                <PhoneOff size={26} />
              </button>
              <button type="button" onClick={() => setKeypad((k) => !k)} aria-pressed={keypad} aria-label="Keypad" className={cx("flex size-12 items-center justify-center rounded-full border", keypad ? "border-data text-data" : "border-line")}>
                <Grid3x3 size={20} />
              </button>
            </>
          )}
        </div>
        {stage === "confirm" && <p className="mt-4 text-[11px] text-faint">About ₹3–6 a minute from your Twilio credit. On the free trial, only numbers verified in Twilio can be called.</p>}
      </div>
    </div>
  );
}
