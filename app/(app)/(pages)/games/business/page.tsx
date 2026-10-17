"use client";

import { ArrowLeft, Users } from "lucide-react";
import Link from "next/link";
import { BusinessGame } from "@/components/games/business-game";
import { useFetch } from "@/lib/client-api";

/** Business (the Indian property game) against HIVEMIND's bots on this device; friends play it at game night. */
export default function BusinessPage() {
  const room = useFetch<{ name: string }>("/api/games/room");
  return (
    <div className="mx-auto max-w-5xl pb-20">
      <Link href="/games" className="mb-3 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-soft hover:text-data">
        <ArrowLeft size={13} /> Games
      </Link>
      <h1 className="mb-1 text-xl font-semibold">Business</h1>
      <p className="mb-3 text-sm text-soft">
        Buy Indian cities, collect rent, build houses and hotels, and send everyone else bankrupt. Play HIVEMIND&apos;s bots here, or with up to 5 friends at{" "}
        <Link href="/games/party" className="inline-flex items-center gap-1 text-data underline">
          <Users size={13} /> game night
        </Link>
        .
      </p>
      {room.data || room.error ? <BusinessGame myName={room.data?.name ?? "You"} /> : <p className="text-sm text-soft">Loading…</p>}
    </div>
  );
}
