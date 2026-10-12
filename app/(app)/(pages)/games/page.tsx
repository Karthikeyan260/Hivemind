import { Music2, PenLine, Dices, Layers, Crown } from "lucide-react";
import Link from "next/link";
import { GameRecord } from "@/components/games/game-record";
import { PageHeader } from "@/components/ui";

const GAMES = [
  { href: "/games/paattu", icon: Music2, title: "Paattu Quiz", who: "1 player", about: "Hear a few seconds of a Tamil song and guess the film. Anirudh, Rahman, Ilaiyaraaja, Vijay hits and more." },
  { href: "/games/chess", icon: Crown, title: "Chess", who: "vs HIVEMIND bot, or a friend online", about: "Play HIVEMIND's bot from Beginner to Hard, or a friend through your link with a clock: 1 min bullet, 3 | 2 blitz, 10 min rapid and more. Voice on with friends." },
  { href: "/games/cards", icon: Layers, title: "Colour Clash", who: "2 players online (+ HIVEMIND bots)", about: "The colour-matching card game (Uno-style) with a friend on their own phone: match colours and numbers, Skip, Reverse, +2, Wild +4, and call Last card! Voice on." },
  { href: "/games/ludo", icon: Dices, title: "Ludo", who: "2 players online (+ HIVEMIND bots)", about: "Classic Ludo with a friend on their own phone through your link, voice on. Add two HIVEMIND bots for a full 4-player board, or play quick with 2 tokens each." },
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
      <GameRecord />
    </div>
  );
}
