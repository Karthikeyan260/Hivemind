"use client";

import { ArrowLeft, Bot, Check, Copy, Send, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ChessVsBot } from "@/components/games/chess/vs-bot";
import { ChessVsFriend } from "@/components/games/chess/vs-friend";
import { cx } from "@/components/ui";
import { useFetch } from "@/lib/client-api";

type Room = { room: string; name: string; link: string };

/**
 * Chess: against HIVEMIND's bot on this device, or online against a friend through the owner's
 * permanent game link (time controls, voice). The friend tab only connects (and opens the mic for
 * voice chat) when chosen.
 */
export default function ChessPage() {
  const room = useFetch<Room>("/api/games/room");
  const [mode, setMode] = useState<"bot" | "friend">("bot");
  const [copied, setCopied] = useState(false);
  const r = room.data;
  const link = r ? `${r.link}${r.link.includes("?") ? "&" : "?"}g=chess` : "";

  // A friend knocking (notification) opens this page with ?friend=1.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from the address
    if (new URLSearchParams(location.search).get("friend") === "1") setMode("friend");
  }, []);

  return (
    <div className="mx-auto max-w-5xl pb-20">
      <Link href="/games" className="mb-3 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-soft hover:text-data">
        <ArrowLeft size={13} /> Games
      </Link>
      <h1 className="mb-1 text-xl font-semibold">Chess</h1>
      <p className="mb-4 text-sm text-soft">Play HIVEMIND (Beginner to Hard) on this device, or a friend online with a clock, from 1-minute bullet to 15 | 10 rapid.</p>

      <div className="mb-4 inline-flex rounded-full border border-line bg-panel p-1">
        {(
          [
            ["bot", "Play HIVEMIND", Bot],
            ["friend", "Play a friend", Users],
          ] as const
        ).map(([m, label, Icon]) => (
          <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m} className={cx("flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold", mode === m ? "bg-core text-core-ink" : "text-soft hover:text-fg")}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {mode === "bot" ? (
        <ChessVsBot myName={r?.name ?? "You"} />
      ) : r ? (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-panel p-3 text-sm">
            <span className="text-soft">Your chess link (always the same):</span>
            <code className="min-w-0 flex-1 truncate font-mono text-xs text-data">{link}</code>
            <button type="button" onClick={() => void navigator.clipboard?.writeText(link).then(() => setCopied(true))} className="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-xs">
              {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
            </button>
            <a href={`https://wa.me/?text=${encodeURIComponent(`Play chess with me on HIVEMIND (save this link, it stays the same): ${link}`)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md bg-ok/90 px-2.5 py-1 text-xs font-medium text-black">
              <Send size={12} /> WhatsApp
            </a>
          </div>
          <ChessVsFriend key={r.room} role="host" room={r.room} myName={r.name} hostName={r.name} />
        </>
      ) : (
        <p className="text-sm text-soft">{room.error ?? "Loading…"}</p>
      )}
    </div>
  );
}
