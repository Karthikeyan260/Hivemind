"use client";

import { ArrowLeft, Check, Copy, Send } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { CardsGame } from "@/components/games/cards-game";
import { useFetch } from "@/lib/client-api";

type Room = { room: string; name: string; link: string };

/** The owner's side of Colour Clash: the same permanent game room as Draw & Guess, with its own link. */
export default function CardsHost() {
  const room = useFetch<Room>("/api/games/room");
  const [copied, setCopied] = useState(false);
  const r = room.data;
  const link = r ? `${r.link}${r.link.includes("?") ? "&" : "?"}g=cards` : "";

  return (
    <div className="mx-auto max-w-5xl pb-20">
      <Link href="/games" className="mb-3 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-soft hover:text-data">
        <ArrowLeft size={13} /> Games
      </Link>
      <h1 className="mb-1 text-xl font-semibold">Colour Clash</h1>
      <p className="mb-3 text-sm text-soft">The colour-matching card game (Uno-style) online with a friend on their own phone, voice on. Match the colour or number, hit them with +2s and Wild +4s, and don&apos;t forget to shout &ldquo;Last card!&rdquo;. Add two HIVEMIND bots for a 4-player table.</p>

      {r && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-panel p-3 text-sm">
          <span className="w-full text-soft sm:w-auto">Your Colour Clash link (always the same):</span>
          <code className="hidden min-w-0 flex-1 truncate font-mono text-xs text-data sm:block">{link}</code>
          <button type="button" onClick={() => void navigator.clipboard?.writeText(link).then(() => setCopied(true))} className="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-xs">
            {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
          </button>
          <a href={`https://wa.me/?text=${encodeURIComponent(`Play Colour Clash (cards) with me on HIVEMIND (save this link, it stays the same): ${link}`)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md bg-ok/90 px-2.5 py-1 text-xs font-medium text-black">
            <Send size={12} /> WhatsApp
          </a>
          <p className="w-full text-xs text-faint">If you&apos;re not here when a friend opens it, you get a notification and the game connects when you open it.</p>
        </div>
      )}

      {r ? <CardsGame key={r.room} role="host" room={r.room} myName={r.name} hostName={r.name} /> : <p className="text-sm text-soft">{room.error ?? "Loading…"}</p>}
    </div>
  );
}
