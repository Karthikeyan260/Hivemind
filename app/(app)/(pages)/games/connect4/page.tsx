"use client";

import { ArrowLeft, Users } from "lucide-react";
import Link from "next/link";
import { Connect4Game } from "@/components/games/connect4-game";
import { useFetch } from "@/lib/client-api";

/** Connect Four against HIVEMIND on this device; a friend plays it at game night. */
export default function Connect4Page() {
  const room = useFetch<{ name: string }>("/api/games/room");
  return (
    <div className="mx-auto max-w-5xl pb-20">
      <Link href="/games" className="mb-3 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-soft hover:text-data">
        <ArrowLeft size={13} /> Games
      </Link>
      <h1 className="mb-1 text-xl font-semibold">Connect Four</h1>
      <p className="mb-3 text-sm text-soft">
        Drop discs and line up four in a row before your opponent does. Play HIVEMIND here, or a friend at{" "}
        <Link href="/games/party" className="inline-flex items-center gap-1 text-data underline">
          <Users size={13} /> game night
        </Link>
        .
      </p>
      {room.data || room.error ? <Connect4Game myName={room.data?.name ?? "You"} /> : <p className="text-sm text-soft">Loading…</p>}
    </div>
  );
}
