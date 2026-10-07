import { Music2, PenLine } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/ui";

const GAMES = [
  { href: "/games/paattu", icon: Music2, title: "Paattu Quiz", who: "1 player", about: "Hear a few seconds of a Tamil song and guess the film. Anirudh, Rahman, Ilaiyaraaja, Vijay hits and more." },
  { href: "/games/draw", icon: PenLine, title: "Draw & Guess", who: "2 players + HIVEMIND", about: "Send a friend a link. One draws, the other guesses, and HIVEMIND guesses too from the drawing. Voice on, so you can laugh at each other's art." },
];

export default function GamesPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="Play" title="Games" subtitle="Quick games inside HIVEMIND, by tap or by voice." />
      <div className="grid gap-3 sm:grid-cols-2">
        {GAMES.map((g) => (
          <Link key={g.href} href={g.href} className="group rounded-xl border border-line bg-panel p-5 hover:border-core/60">
            <g.icon size={22} className="text-core" />
            <h2 className="mt-3 text-lg font-semibold group-hover:text-core">{g.title}</h2>
            <p className="font-mono text-[10.5px] uppercase tracking-wider text-faint">{g.who}</p>
            <p className="mt-2 text-sm leading-relaxed text-soft">{g.about}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
