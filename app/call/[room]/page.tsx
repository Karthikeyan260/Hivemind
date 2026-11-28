"use client";

import type { DataConnection, MediaConnection, Peer } from "peerjs";
import { ChevronLeft, Copy, Mic, MicOff, Phone, PhoneOff, Send } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Screener } from "@/components/call/screener";
import { cx } from "@/components/ui";
import { PEER_OPTIONS } from "@/lib/ice";
import { checkHost, proveHost } from "@/lib/peer-auth";

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

/**
 * How loud a stream is right now (0 to 1), read about 15 times a second: the avatar glows when the other
 * person speaks, and the mute button's ring shows your own mic is picking you up. Nothing is recorded.
 */
function useLevel(stream: MediaStream | null) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!stream || !stream.getAudioTracks().length) return;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    let ctx: AudioContext;
    try {
      ctx = new Ctx();
    } catch {
      return;
    }
    void ctx.resume().catch(() => {});
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    const buf = new Uint8Array(an.fftSize);
    let last = 0;
    let shown = 0;
    let raf = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 66) return;
      last = t;
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += ((v - 128) / 128) ** 2;
      // Speech sits around 0.02-0.2 RMS: stretch it to 0..1, and only re-render on a visible change.
      const l = Math.min(1, Math.sqrt(sum / buf.length) * 6);
      if (Math.abs(l - shown) > 0.06) {
        shown = l;
        setLevel(l);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      src.disconnect();
      void ctx.close().catch(() => {});
      setLevel(0);
    };
  }, [stream]);
  return level;
}

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
  // The owner's permanent "call me" link: the caller says who they are first.
  const permanent = room.startsWith("me");
  const [guestName, setGuestName] = useState("");
  // Nobody picked up: HIVEMIND answers (call screening), when the owner has it on.
  const [screen, setScreen] = useState<{ mode: "missed" | "always"; wait_s: number } | null>(null);
  const [screening, setScreening] = useState<"no" | "on" | "done">("no");
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  // The other person's audio, for the "they're talking" glow.
  const [remote, setRemote] = useState<MediaStream | null>(null);
  const theirLevel = useLevel(remote);
  const myLevel = useLevel(micStream);

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
    setRemote(null);
    setMicStream(null);
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

  // The owner didn't pick up in time (or screens every call): HIVEMIND answers instead.
  // (The stage flips between waiting and connecting while it redials, so the timer reads it from a ref.)
  const stageNow = useRef(stage);
  useEffect(() => {
    stageNow.current = stage;
  }, [stage]);
  useEffect(() => {
    if (isHost || !screen || screening !== "no") return;
    const t = setTimeout(() => {
      if (stageNow.current === "waiting" || stageNow.current === "connecting") setScreening("on");
    }, screen.mode === "always" ? 1500 : screen.wait_s * 1000);
    return () => clearTimeout(t);
  }, [isHost, screen, screening]);

  useEffect(() => {
    if (stage !== "live") return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [stage]);

  const attach = useCallback(
    (c: MediaConnection) => {
      call.current = c;
      c.on("stream", (theirs) => {
        if (audio.current) {
          audio.current.srcObject = theirs;
          void audio.current.play().catch(() => {});
        }
        setRemote(theirs);
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
      setMicStream(mic.current);
    } catch {
      setError("Microphone permission is needed for the call.");
      setStage("error");
      return;
    }
    const { default: PeerCtor } = await import("peerjs");
    if (isHost) {
      const p = new PeerCtor(hostId, PEER_OPTIONS);
      peer.current = p;
      p.on("open", () => setStage("waiting"));
      // A caller first checks this really is the owner (their link's peer id is public): prove it.
      p.on("connection", (dc: DataConnection) => {
        dc.on("data", (d) => {
          const m = d as { t?: string; nonce?: unknown };
          if (m?.t !== "challenge" || typeof m.nonce !== "string") return;
          void proveHost("call", room, m.nonce.slice(0, 64)).then((proof) => proof && dc.send({ t: "proof", proof }));
        });
      });
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
      const p = new PeerCtor(PEER_OPTIONS);
      peer.current = p;
      // Ring the owner's phone once (push notification), in case they aren't on the call screen yet.
      void fetch("/api/call/ring", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ room, name: guestName.trim() || undefined }) })
        .then((r) => r.json())
        .then((j) => setScreen(j.screen ?? null))
        .catch(() => {});
      // Check the host first (anyone could squat the public peer id); the audio starts only after.
      // Each try's connection is closed before the next, so waiting doesn't pile them up.
      let pending: DataConnection | null = null;
      const dial = () => {
        pending?.close();
        const dc = p.connect(hostId, { reliable: true });
        pending = dc;
        const nonce = crypto.randomUUID();
        dc.on("open", () => dc.send({ t: "challenge", nonce }));
        dc.on("data", (d) => {
          const m = d as { t?: string; proof?: unknown };
          if (m?.t !== "proof") return;
          void checkHost("call", room, nonce, m.proof).then((ok) => {
            dc.close();
            if (pending === dc) pending = null;
            if (!ok) {
              setError("This link isn't being answered by its owner right now. Try again later.");
              setStage("error");
              return;
            }
            setStage("connecting");
            attach(p.call(hostId, mic.current!));
          });
        });
      };
      p.on("open", dial);
      p.on("error", (e) => {
        // The host hasn't opened the call yet: keep trying quietly.
        if (e.type === "peer-unavailable") {
          setStage("waiting");
          pending?.close();
          pending = null;
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
          className="fixed top-[max(0.5rem,env(safe-area-inset-top))] left-2 flex h-10 items-center gap-1 rounded-md px-2 font-mono text-[12px] tracking-wider text-data uppercase transition-colors hover:bg-raised"
        >
          <ChevronLeft size={15} /> {stage === "live" ? "End & back" : "HIVEMIND"}
        </button>
      )}
      <div className="font-mono text-[11px] tracking-[0.3em] text-faint">HIVEMIND · CALL</div>

      <div className="flex flex-col items-center gap-4 text-center">
        {/* the other person's avatar glows as they speak */}
        <div
          className={cx("flex size-28 items-center justify-center rounded-full border-2 text-4xl font-semibold uppercase transition-[box-shadow] duration-100", stage === "live" ? "border-ok text-ok" : "border-data/40 text-data")}
          style={stage === "live" ? { boxShadow: `0 0 0 ${Math.round(4 + theirLevel * 18)}px oklch(0.8 0.14 150 / ${(0.12 + theirLevel * 0.3).toFixed(2)})` } : undefined}
        >
          {other.slice(0, 1)}
        </div>
        {stage === "live" && <p className={cx("-mb-2 text-xs transition-opacity", theirLevel > 0.15 ? "text-ok opacity-100" : "opacity-0")} aria-hidden>{other} is talking</p>}
        <div>
          <div className="text-2xl font-semibold capitalize">{other}</div>
          <div className={cx("mt-1 font-mono text-sm", stage === "error" ? "text-alert" : "text-soft")}>
            {screening === "on" && stage !== "live" ? `${other} didn't pick up · HIVEMIND is answering` : screening === "done" ? "Your message was passed on." : status[stage]}
          </div>
        </div>
      </div>

      {!isHost && permanent && stage === "ready" && (
        <input
          value={guestName}
          onChange={(e) => setGuestName(e.target.value.slice(0, 40))}
          placeholder="Your name"
          aria-label="Your name"
          className="w-full max-w-xs rounded-full border border-line bg-panel px-4 py-3 text-center text-sm text-fg placeholder:text-faint"
        />
      )}

      {!isHost && screening === "on" && stage !== "live" && micStream && (
        <Screener
          room={room}
          name={guestName.trim()}
          owner={other}
          mic={micStream}
          onFinished={() => {
            setScreening("done");
            end();
          }}
        />
      )}

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

      {/* each button says what it does underneath */}
      <div className={cx("flex items-start gap-8", !isHost && screening === "on" && stage !== "live" && "hidden")}>
        {(stage === "ready" || stage === "error" || stage === "ended") && !(stage === "ended" && !isHost) && (
          <button type="button" onClick={start} aria-label="Start call" className="flex flex-col items-center gap-2 text-sm text-soft">
            <span className="flex size-16 items-center justify-center rounded-full bg-ok text-black shadow-lg transition-transform active:scale-95">
              <Phone size={26} />
            </span>
            {stage === "ready" ? (isHost ? "Start call" : "Call") : "Call again"}
          </button>
        )}
        {(stage === "waiting" || stage === "connecting" || stage === "live") && (
          <>
            <button type="button" onClick={toggleMute} aria-pressed={muted} aria-label={muted ? "Unmute" : "Mute"} className={cx("flex flex-col items-center gap-2 text-sm", muted ? "text-alert" : "text-soft")}>
              {/* your own mic level rings the button: proof the other side can hear you */}
              <span
                className={cx("flex size-16 items-center justify-center rounded-full border-2 transition-[box-shadow,background-color] duration-100 active:scale-95", muted ? "border-alert bg-alert text-white" : "border-line bg-raised text-fg")}
                style={!muted && myLevel > 0.05 ? { boxShadow: `0 0 0 ${Math.round(2 + myLevel * 8)}px oklch(0.84 0.085 215 / 0.35)` } : undefined}
              >
                {muted ? <MicOff size={24} /> : <Mic size={24} />}
              </span>
              {muted ? "Muted" : "Mute"}
            </button>
            <button type="button" onClick={end} aria-label="Hang up" className="flex flex-col items-center gap-2 text-sm text-soft">
              <span className="flex size-16 items-center justify-center rounded-full bg-alert text-white shadow-lg transition-transform active:scale-95">
                <PhoneOff size={26} />
              </span>
              End
            </button>
          </>
        )}
      </div>
      {muted && stage === "live" && <p className="-mt-4 text-xs text-alert">You&apos;re muted: {other} can&apos;t hear you.</p>}

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
              className="w-full rounded-full border border-data/40 py-3 text-sm text-data transition-colors hover:bg-data/10 disabled:border-ok/40 disabled:text-ok"
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
      {!isHost && <p className="max-w-xs text-center text-xs leading-relaxed text-faint">Private browser call. Nothing is recorded. Allow the microphone when asked.</p>}
    </main>
  );
}
