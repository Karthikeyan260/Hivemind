import { Music2, PenLine, Dices, Layers, Crown, Grid3x3, Users, Spline, Building2 } from "lucide-react";
import Link from "next/link";
import { GameRecord } from "@/components/games/game-record";
import { PageHeader } from "@/components/ui";

const GAMES = [
  { href: "/games/party", icon: Users, title: "Game night", who: "you + up to 5 friends", about: "One link for all your friends. They join the lobby, you pick the game (Colour Clash, Ludo, Business, Snakes & Ladders, Draw & Guess, Dots or Chess) and everyone plays together, then the next one. Voice on." },
  { href: "/games/paattu", icon: Music2, title: "Paattu Quiz", who: "1 player", about: "Hear a few seconds of a Tamil song and guess the film. Anirudh, Rahman, Ilaiyaraaja, Vijay hits and more." },
  { href: "/games/chess", icon: Crown, title: "Chess", who: "vs HIVEMIND bot, or a friend online", about: "Play HIVEMIND's bot from Beginner to Hard, or a friend through your link with a clock: 1 min bullet, 3 | 2 blitz, 10 min rapid and more. Voice on with friends." },
  { href: "/games/cards", icon: Layers, title: "Colour Clash", who: "vs HIVEMIND, or a friend online", about: "The colour-matching card game (Uno-style) against HIVEMIND, or a friend on their own phone: match colours and numbers, Skip, Reverse, +2, Wild +4, and call Last card! Voice on." },
  { href: "/games/business", icon: Building2, title: "Business", who: "vs HIVEMIND, or at game night", about: "The Indian property game: buy Agra to Mumbai, collect rent, build houses and hotels, and bankrupt everyone else. Set a round limit for a quicker game." },
  { href: "/games/snakes", icon: Spline, title: "Snakes & Ladders", who: "vs HIVEMIND, or at game night", about: "The classic: roll, climb the ladders, slide down the snakes, and land exactly on 100 to win. Up to 6 players." },
  { href: "/games/ludo", icon: Dices, title: "Ludo", who: "vs HIVEMIND, or a friend online", about: "Classic Ludo against HIVEMIND, or a friend on their own phone through your link, voice on. Add two HIVEMIND bots for a full 4-player board, or play quick with 2 tokens each." },
  { href: "/games/dots", icon: Grid3x3, title: "Dots & Boxes", who: "vs HIVEMIND, or a friend online", about: "Draw lines between dots, close a box to claim it and go again. Simple to learn, sneaky to master: don't hand your opponent a chain of boxes." },
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
