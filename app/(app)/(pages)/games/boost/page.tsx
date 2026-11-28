"use client";

import { ArrowLeft, Users } from "lucide-react";
import Link from "next/link";
import { BoostGame } from "@/components/games/boost-game";
import { useFetch } from "@/lib/client-api";

/** Boost (3 Roses / Allimalli) against HIVEMIND's bots on this device; friends play it at game night. */
export default function BoostPage() {
  const room = useFetch<{ name: string }>("/api/games/room");
  return (
    <div className="mx-auto max-w-5xl pb-20">
      <Link href="/games" className="-ml-2 mb-2 inline-flex h-10 items-center gap-1.5 rounded-md px-2 font-mono text-[12px] uppercase tracking-wider text-soft transition-colors hover:bg-raised hover:text-data">
        <ArrowLeft size={13} /> Games
      </Link>
      <h1 className="mb-1 text-xl font-semibold">Boost 🌹</h1>
      <p data-game-intro className="mb-3 text-sm text-soft">
        Also called 3 Roses or Allimalli. Everyone writes a name in the theme; three cards of each name are dealt and passed round the table, one at a time. Hold three of a kind and tap BOOST first for 1000 points, then everyone races: 900, 800… Play HIVEMIND&apos;s bots here, or with friends at{" "}
        <Link href="/games/party" className="inline-flex items-center gap-1 text-data underline">
          <Users size={13} /> game night
        </Link>
        .
      </p>
      {room.data || room.error ? <BoostGame myName={room.data?.name ?? "You"} /> : <p className="text-sm text-soft">Loading…</p>}
    </div>
  );
}
