"use client";

import type { MediaConnection, Peer } from "peerjs";
import { ChevronLeft, Copy, Mic, MicOff, Phone, PhoneOff, Send } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";

type Stage = "ready" | "starting" | "waiting" | "connecting" | "live" | "ended" | "error";

/**
 * A private internet voice call between the owner and someone they invited. Browser to browser
 * (WebRTC); PeerJS's free public broker introduces the two browsers, then audio flows directly
 * (or through PeerJS's free relay when a network blocks direct connections). Nothing is recorded.
 */
export default function CallPage() {
  return (
    <Suspense>
      <Call />
    </Suspense>
  );
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function Call() {
  const { room } = useParams<{ room: string }>();
  const q = useSearchParams();
  const router = useRouter();
  const isHost = q.get("host") === "1";
  const other = isHost ? q.get("name") || "your guest" : q.get("from") || "HIVEMIND";
  const inviteTo = q.get("to");
  const hostId = `hivemind-call-${room}`;

  const [stage, setStage] = useState<Stage>("ready");
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  // Host: back to HIVEMIND on its own a few seconds after the call ends (the page has no app nav).
  const [leaveIn, setLeaveIn] = useState<number | null>(null);
  const peer = useRef<Peer | null>(null);
  const call = useRef<MediaConnection | null>(null);
  const mic = useRef<MediaStream | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);

  const guestLink = typeof window === "undefined" ? "" : `${location.origin}/call/${room}?from=${encodeURIComponent(q.get("from") || "")}`;

  const cleanup = useCallback(() => {
    if (retry.current) clearTimeout(retry.current);
    call.current?.close();
    peer.current?.destroy();
    mic.current?.getTracks().forEach((t) => t.stop());
    call.current = peer.current = mic.current = null;
  }, []);

  const end = useCallback(() => {
    cleanup();
    setStage("ended");
  }, [cleanup]);

  useEffect(() => cleanup, [cleanup]);

  const goHome = useCallback(() => {
    cleanup();
    router.replace("/");
  }, [cleanup, router]);

  useEffect(() => {
    if (!isHost || stage !== "ended") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- start the return countdown when the call ends
    setLeaveIn(5);
    const t = setInterval(() => setLeaveIn((n) => (n == null ? n : n - 1)), 1000);
    return () => clearInterval(t);
  }, [isHost, stage]);
  useEffect(() => {
    if (leaveIn === 0) goHome();
  }, [leaveIn, goHome]);

  useEffect(() => {
    if (stage !== "live") return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [stage]);

  const attach = useCallback(
    (c: MediaConnection) => {
      call.current = c;
      c.on("stream", (remote) => {
        if (audio.current) {
          audio.current.srcObject = remote;
          void audio.current.play().catch(() => {});
        }
        setStage("live");
      });
      c.on("close", end);
      c.on("error", end);
      // "close" isn't always delivered when the other side vanishes; the connection state is.
      const watch = () => {
        const st = c.peerConnection?.iceConnectionState;
        if (st === "failed" || st === "closed" || st === "disconnected") setTimeout(() => c.peerConnection?.iceConnectionState !== "connected" && end(), 4000);
      };
      setTimeout(() => c.peerConnection?.addEventListener("iceconnectionstatechange", watch), 0);
    },
    [end],
  );

  // Needs a tap: browsers only allow the mic and audio playback after a user gesture.
  async function start() {
    setStage("starting");
    setError("");
    try {
      mic.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      setError("Microphone permission is needed for the call.");
      setStage("error");
      return;
    }
    const { default: PeerCtor } = await import("peerjs");
    if (isHost) {
      const p = new PeerCtor(hostId);
      peer.current = p;
      p.on("open", () => setStage("waiting"));
      p.on("call", (c) => {
        if (call.current) return c.close(); // one guest at a time
        setStage("connecting");
        c.answer(mic.current!);
        attach(c);
      });
      p.on("error", (e) => {
        setError(e.type === "unavailable-id" ? "This call is already open in another tab." : "Couldn't open the call. Check your connection and try again.");
        setStage("error");
      });
    } else {
      const p = new PeerCtor();
      peer.current = p;
      const dial = () => {
        setStage("connecting");
        attach(p.call(hostId, mic.current!));
      };
      p.on("open", dial);
      p.on("error", (e) => {
        // The host hasn't opened the call yet: keep trying quietly.
        if (e.type === "peer-unavailable") {
          setStage("waiting");
          retry.current = setTimeout(dial, 3000);
        } else {
          setError("Couldn't connect the call. Check your connection and try again.");
          setStage("error");
        }
      });
    }
  }

  function toggleMute() {
    const on = !muted;
    mic.current?.getAudioTracks().forEach((t) => (t.enabled = !on));
    setMuted(on);
  }

  async function saveNote() {
    const when = new Date().toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
    const r = await fetch("/api/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: `Had a HIVEMIND voice call with ${other} on ${when}, lasting ${fmt(seconds)}.` }),
    });
    setSaved(r.ok);
    if (r.ok) setLeaveIn(2);
  }

  const status: Record<Stage, string> = {
    ready: isHost ? `Start the call, then send ${other} the link.` : `${other} invited you to a voice call.`,
    starting: "Turning on your microphone…",
    waiting: isHost ? `Waiting for ${other} to join…` : `Waiting for ${other} to open the call…`,
    connecting: "Connecting…",
    live: fmt(seconds),
    ended: seconds ? `Call ended · ${fmt(seconds)}` : "Call ended",
    error,
  };

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-bg px-6 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] text-fg">
      <audio ref={audio} autoPlay playsInline />
      {isHost && (
        <button
          type="button"
          onClick={goHome}
          className="fixed left-4 top-[max(1rem,env(safe-area-inset-top))] flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-data"
        >
          <ChevronLeft size={14} /> {stage === "live" ? "End & back" : "HIVEMIND"}
        </button>
      )}
      <div className="font-mono text-[11px] tracking-[0.3em] text-faint">HIVEMIND · CALL</div>

      <div className="flex flex-col items-center gap-4 text-center">
        <div className={cx("flex size-28 items-center justify-center rounded-full border-2 text-4xl font-semibold uppercase", stage === "live" ? "border-ok text-ok motion-safe:animate-pulse" : "border-data/40 text-data")}>
          {other.slice(0, 1)}
        </div>
        <div>
          <div className="text-2xl font-semibold capitalize">{other}</div>
          <div className={cx("mt-1 font-mono text-sm", stage === "error" ? "text-alert" : "text-soft")}>{status[stage]}</div>
        </div>
      </div>

      {isHost && stage === "waiting" && (
        <div className="flex w-full max-w-xs flex-col gap-2">
          {inviteTo && (
            <a
              href={`https://wa.me/${inviteTo.replace(/^\+/, "")}?text=${encodeURIComponent(`${q.get("from") || "I"} is calling you on HIVEMIND. Tap to join: ${guestLink}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 rounded-full bg-ok/90 py-3 text-sm font-medium text-black"
            >
              <Send size={16} /> Send link on WhatsApp
            </a>
          )}
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(guestLink).then(() => setCopied(true));
            }}
            className="flex items-center justify-center gap-2 rounded-full border border-line py-3 text-sm text-soft"
          >
            <Copy size={16} /> {copied ? "Link copied" : "Copy invite link"}
          </button>
        </div>
      )}

      <div className="flex items-center gap-6">
        {(stage === "ready" || stage === "error" || stage === "ended") && !(stage === "ended" && !isHost) && (
          <button type="button" onClick={start} aria-label="Start call" className="flex size-16 items-center justify-center rounded-full bg-ok text-black">
            <Phone size={26} />
          </button>
        )}
        {(stage === "waiting" || stage === "connecting" || stage === "live") && (
          <>
            <button
              type="button"
              onClick={toggleMute}
              aria-pressed={muted}
              aria-label={muted ? "Unmute" : "Mute"}
              className={cx("flex size-14 items-center justify-center rounded-full border", muted ? "border-alert bg-alert/15 text-alert" : "border-line text-fg")}
            >
              {muted ? <MicOff size={22} /> : <Mic size={22} />}
            </button>
            <button type="button" onClick={end} aria-label="Hang up" className="flex size-16 items-center justify-center rounded-full bg-alert text-white">
              <PhoneOff size={26} />
            </button>
          </>
        )}
      </div>

      {isHost && stage === "ended" && (
        <div className="flex w-full max-w-xs flex-col items-center gap-3">
          {seconds > 0 && (
            <button
              type="button"
              onClick={() => {
                setLeaveIn(null);
                void saveNote();
              }}
              disabled={saved}
              className="font-mono text-[11px] uppercase tracking-wider text-data disabled:text-ok"
            >
              {saved ? "Saved to your memories ✓" : "Save this call to memory"}
            </button>
          )}
          <button type="button" onClick={goHome} className="w-full rounded-full border border-line py-3 text-sm text-fg">
            Back to HIVEMIND{leaveIn != null && leaveIn > 0 ? ` (${leaveIn})` : ""}
          </button>
        </div>
      )}
      {!isHost && stage === "ended" && <p className="text-center text-sm text-soft">You can close this page now.</p>}
      {!isHost && <p className="max-w-xs text-center text-[11.5px] text-faint">Private browser call. Nothing is recorded. Allow the microphone when asked.</p>}
    </main>
  );
}
