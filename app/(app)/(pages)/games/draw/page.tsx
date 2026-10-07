"use client";

import { ArrowLeft, Check, Copy, RefreshCw, Send } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DrawGame } from "@/components/games/draw-game";
import { api, useFetch } from "@/lib/client-api";

type Room = { room: string; name: string; link: string };

/**
 * The owner's side of Draw & Guess. Every game uses the owner's permanent game link, so friends keep
 * one link; when a friend opens it while the owner isn't here, the owner gets a notification.
 */
export default function DrawHost() {
  const room = useFetch<Room>("/api/games/room");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const r = room.data;

  async function newLink() {
    if (!confirm("Make a new game link? The old one stops working for everyone you shared it with.")) return;
    setBusy(true);
    try {
      room.setData(await api<Room>("/api/games/room", { method: "PATCH", json: { reset: true } }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl pb-20">
      <Link href="/games" className="mb-3 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-soft hover:text-data">
        <ArrowLeft size={13} /> Games
      </Link>
      <h1 className="mb-1 text-xl font-semibold">Draw & Guess</h1>
      <p className="mb-3 text-sm text-soft">Take turns drawing; the other guesses by typing or saying it. HIVEMIND watches the drawing and guesses too. 6 rounds, 80 seconds each, with voice on.</p>

      {r && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-panel p-3 text-sm">
          <span className="text-soft">Your game link (always the same):</span>
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-data">{r.link}</code>
          <button type="button" onClick={() => void navigator.clipboard?.writeText(r.link).then(() => setCopied(true))} className="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-xs">
            {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
          </button>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(`Play Draw & Guess with me on HIVEMIND (save this link, it stays the same): ${r.link}`)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md bg-ok/90 px-2.5 py-1 text-xs font-medium text-black"
          >
            <Send size={12} /> WhatsApp
          </a>
          <button type="button" onClick={newLink} disabled={busy} title="Stop the old link working" className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-soft hover:text-fg">
            <RefreshCw size={12} /> New link
          </button>
          <p className="w-full text-xs text-faint">Friends can open it any time: if you&apos;re not here, you get a notification and the game connects when you open it.</p>
        </div>
      )}

      {r ? <DrawGame key={r.room} role="host" room={r.room} myName={r.name} hostName={r.name} /> : <p className="text-sm text-soft">{room.error ?? "Loading…"}</p>}
    </div>
  );
}
