"use client";

import { ArrowLeft, Check, Copy, Send } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DotsGame } from "@/components/games/dots-game";
import { ModeTabs, useGameMode } from "@/components/games/mode-tabs";
import { useFetch } from "@/lib/client-api";

type Room = { room: string; name: string; link: string };

/** Dots & Boxes: against HIVEMIND on this device, or a friend through the permanent game link. */
export default function DotsHost() {
  const room = useFetch<Room>("/api/games/room");
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useGameMode();
  const r = room.data;
  const link = r ? `${r.link}${r.link.includes("?") ? "&" : "?"}g=dots` : "";

  return (
    <div className="mx-auto max-w-5xl pb-20">
      <Link href="/games" className="mb-3 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-soft hover:text-data">
        <ArrowLeft size={13} /> Games
      </Link>
      <h1 className="mb-1 text-xl font-semibold">Dots &amp; Boxes</h1>
      <p className="mb-3 text-sm text-soft">Take turns drawing a line between two dots. Close the fourth side of a box to claim it and go again; most boxes wins. Against HIVEMIND on this device, or a friend on their own phone with voice on.</p>

      <ModeTabs mode={mode} onChange={setMode} />

      {mode === "friend" && r && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-panel p-3 text-sm">
          <span className="w-full text-soft sm:w-auto">Your Dots &amp; Boxes link (always the same):</span>
          <code className="hidden min-w-0 flex-1 truncate font-mono text-xs text-data sm:block">{link}</code>
          <button type="button" onClick={() => void navigator.clipboard?.writeText(link).then(() => setCopied(true))} className="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-xs">
            {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
          </button>
          <a href={`https://wa.me/?text=${encodeURIComponent(`Play Dots and Boxes with me on HIVEMIND (save this link, it stays the same): ${link}`)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md bg-ok/90 px-2.5 py-1 text-xs font-medium text-black">
            <Send size={12} /> WhatsApp
          </a>
          <p className="w-full text-xs text-faint">If you&apos;re not here when a friend opens it, you get a notification and the game connects when you open it.</p>
        </div>
      )}

      {mode === "bot" ? (
        // After the room loads (so only in the browser: the saved solo game lives on this device).
        r || room.error ? (
          <DotsGame key="solo" role="host" room="solo" myName={r?.name ?? "You"} solo />
        ) : (
          <p className="text-sm text-soft">Loading…</p>
        )
      ) : r ? <DotsGame key={r.room} role="host" room={r.room} myName={r.name} hostName={r.name} /> : <p className="text-sm text-soft">{room.error ?? "Loading…"}</p>}
    </div>
  );
}
