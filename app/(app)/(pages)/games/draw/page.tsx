"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DrawGame } from "@/components/games/draw-game";
import { useFetch } from "@/lib/client-api";

/** The owner's side of Draw & Guess: makes a game room and runs the game (and HIVEMIND's guesses). */
export default function DrawHost() {
  const brain = useFetch<{ profile: { name: string } | null }>("/api/brain");
  const [room] = useState(() => crypto.randomUUID().replace(/-/g, "").slice(0, 16));
  const name = brain.data?.profile?.name?.split(" ")[0];
  return (
    <div className="mx-auto max-w-5xl pb-20">
      <Link href="/games" className="mb-3 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-soft hover:text-data">
        <ArrowLeft size={13} /> Games
      </Link>
      <h1 className="mb-1 text-xl font-semibold">Draw & Guess</h1>
      <p className="mb-4 text-sm text-soft">Invite a friend. You take turns drawing; the other guesses by typing. HIVEMIND watches the drawing and guesses too. 6 rounds, 80 seconds each.</p>
      {brain.data || brain.error ? <DrawGame role="host" room={room} myName={name || "Host"} hostName={name || "Host"} /> : <p className="text-sm text-soft">Loading…</p>}
    </div>
  );
}
