"use client";

import { ArrowLeft, Check, Copy, Send } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PartyTable } from "@/components/games/party-table";
import { useFetch } from "@/lib/client-api";

type Room = { room: string; name: string; link: string };

/**
 * Game night, the owner's side: one link for everyone. Friends who open it wait in the lobby; the
 * owner picks the game and everyone plays together, then picks the next one.
 */
export default function PartyHost() {
  const room = useFetch<Room>("/api/games/room");
  const [copied, setCopied] = useState(false);
  const r = room.data;
  const link = r ? `${r.link}${r.link.includes("?") ? "&" : "?"}g=party` : "";

  return (
    <div className="mx-auto max-w-5xl pb-20">
      <Link href="/games" className="mb-3 inline-flex items-center gap-1 font-mono text-[11px] tracking-wider text-soft uppercase hover:text-data">
        <ArrowLeft size={13} /> Games
      </Link>
      <h1 className="mb-1 text-xl font-semibold">🎮 Game night</h1>
      <p className="mb-3 text-sm text-soft">One link for all your friends (up to 6 players with you). They wait in the lobby; you pick the game, everyone plays, then you pick the next one. Voice chat: tap the mic button when you want to talk.</p>

      {r && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-panel p-3 text-sm">
          <span className="w-full text-soft sm:w-auto">Your game night link (always the same):</span>
          <code className="hidden min-w-0 flex-1 truncate font-mono text-xs text-data sm:block">{link}</code>
          <button type="button" onClick={() => void navigator.clipboard?.writeText(link).then(() => setCopied(true))} className="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-xs">
            {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
          </button>
          <a href={`https://wa.me/?text=${encodeURIComponent(`Game night on HIVEMIND! Join me (save this link, it stays the same): ${link}`)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md bg-ok/90 px-2.5 py-1 text-xs font-medium text-black">
            <Send size={12} /> WhatsApp
          </a>
          <p className="w-full text-xs text-faint">If you&apos;re not here when a friend opens it, you get a notification; the lobby opens when you come to this page.</p>
        </div>
      )}

      {r ? <PartyTable key={r.room} role="host" room={r.room} myName={r.name} hostName={r.name} /> : <p className="text-sm text-soft">{room.error ?? "Loading…"}</p>}
    </div>
  );
}
