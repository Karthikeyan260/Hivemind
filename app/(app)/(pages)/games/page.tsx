import { Music2, PenLine, CircleDot, Dices, Layers, Crown, Grid3x3, Hash, Users, Spline, Building2, ArrowRight, Play } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";
import { GameRecord } from "@/components/games/game-record";
import { PageHeader } from "@/components/ui";

type Game = { href: string; icon: typeof Users; title: string; who: string; tag: string; about: string; art: CSSProperties };

/** Each game's banner, drawn with CSS only (its board, its pieces, its colours). */
const ART = {
  paattu: { background: "repeating-linear-gradient(90deg, oklch(0.75 0.15 330 / 0.5) 0 3px, transparent 3px 9px), linear-gradient(135deg, oklch(0.45 0.15 330), oklch(0.35 0.1 280))" },
  chess: { background: "repeating-conic-gradient(oklch(0.85 0.02 80) 0 25%, oklch(0.32 0.03 60) 0 50%) 0 0 / 24px 24px" },
  cards: { background: "linear-gradient(115deg, oklch(0.62 0.2 25) 0 25%, oklch(0.8 0.16 90) 25% 50%, oklch(0.65 0.17 150) 50% 75%, oklch(0.6 0.15 250) 75%)" },
  business: { background: "linear-gradient(oklch(1 0 0 / 0.12) 1px, transparent 1px) 0 0 / 22px 22px, linear-gradient(90deg, oklch(1 0 0 / 0.12) 1px, transparent 1px) 0 0 / 22px 22px, linear-gradient(135deg, oklch(0.5 0.12 160), oklch(0.36 0.08 200))" },
  bingo: { background: "linear-gradient(oklch(1 0 0 / 0.22) 2px, transparent 2px) 0 0 / 20% 20%, linear-gradient(90deg, oklch(1 0 0 / 0.22) 2px, transparent 2px) 0 0 / 20% 20%, linear-gradient(135deg, oklch(0.55 0.14 300), oklch(0.4 0.12 270))" },
  connect4: { background: "radial-gradient(circle, oklch(0.82 0.16 90) 0 7px, transparent 8px) 0 0 / 26px 26px, radial-gradient(circle, oklch(0.62 0.2 25) 0 7px, transparent 8px) 13px 13px / 26px 26px, oklch(0.42 0.12 255)" },
  snakes: { background: "repeating-linear-gradient(45deg, oklch(0.7 0.15 140 / 0.6) 0 10px, oklch(0.55 0.13 90 / 0.5) 10px 20px), oklch(0.35 0.06 120)" },
  ludo: { background: "conic-gradient(oklch(0.62 0.2 25) 0 25%, oklch(0.65 0.17 150) 0 50%, oklch(0.8 0.16 90) 0 75%, oklch(0.6 0.15 250) 0)" },
  dots: { background: "radial-gradient(circle, oklch(0.95 0 0 / 0.85) 0 2px, transparent 2.5px) 0 0 / 18px 18px, linear-gradient(135deg, oklch(0.4 0.08 220), oklch(0.3 0.05 260))" },
  draw: { background: "radial-gradient(circle at 25% 40%, oklch(0.75 0.16 60 / 0.7), transparent 40%), radial-gradient(circle at 70% 60%, oklch(0.7 0.16 330 / 0.6), transparent 45%), linear-gradient(135deg, oklch(0.42 0.1 280), oklch(0.32 0.06 230))" },
} satisfies Record<string, CSSProperties>;

const NIGHT: Game = {
  href: "/games/party",
  icon: Users,
  title: "Game night",
  who: "you + up to 5 friends",
  tag: "One link for everyone. Pick a game, play, pick the next. Voice on.",
  about: "One link for all your friends. They join the lobby, you pick the game (Colour Clash, Ludo, Business, Snakes & Ladders, Draw & Guess, Dots or Chess) and everyone plays together, then the next one. Voice on.",
  art: {},
};
const GAMES: Game[] = [
  { href: "/games/paattu", icon: Music2, title: "Paattu Quiz", who: "1 player", tag: "Hear a few seconds, guess the film.", about: "Hear a few seconds of a Tamil song and guess the film. Anirudh, Rahman, Ilaiyaraaja, Vijay hits and more.", art: ART.paattu },
  { href: "/games/chess", icon: Crown, title: "Chess", who: "vs bot or a friend online", tag: "Beginner to Hard, or a friend on the clock.", about: "Play HIVEMIND's bot from Beginner to Hard, or a friend through your link with a clock: 1 min bullet, 3 | 2 blitz, 10 min rapid and more. Voice on with friends.", art: ART.chess },
  { href: "/games/cards", icon: Layers, title: "Colour Clash", who: "vs bot or a friend online", tag: "Match colours and numbers. Last card!", about: "The colour-matching card game (Uno-style) against HIVEMIND, or a friend on their own phone: match colours and numbers, Skip, Reverse, +2, Wild +4, and call Last card! Voice on.", art: ART.cards },
  { href: "/games/business", icon: Building2, title: "Business", who: "vs bot, or at game night", tag: "Buy Agra to Mumbai, build hotels, win.", about: "The Indian property game: buy Agra to Mumbai, collect rent, build houses and hotels, and bankrupt everyone else. Set a round limit for a quicker game.", art: ART.business },
  { href: "/games/bingo", icon: Hash, title: "Bingo", who: "up to 6 players", tag: "Fill your card, spell B-I-N-G-O first.", about: "The pen-and-paper game: fill a 5×5 card with 1–25 your way, take turns calling numbers, and every complete row, column or diagonal earns a letter of B-I-N-G-O. Spell it first to win. Up to 6 players.", art: ART.bingo },
  { href: "/games/connect4", icon: CircleDot, title: "Connect Four", who: "vs bot, or at game night", tag: "Four in a row before HIVEMIND does.", about: "Drop discs and line up four in a row before HIVEMIND does. Three levels, from easy to hard; friends can play it at game night.", art: ART.connect4 },
  { href: "/games/snakes", icon: Spline, title: "Snakes & Ladders", who: "up to 6 players", tag: "Climb, slide, land exactly on 100.", about: "The classic: roll, climb the ladders, slide down the snakes, and land exactly on 100 to win. Up to 6 players.", art: ART.snakes },
  { href: "/games/ludo", icon: Dices, title: "Ludo", who: "vs bot or a friend online", tag: "Classic Ludo, 2 to 4 players.", about: "Classic Ludo against HIVEMIND, or a friend on their own phone through your link, voice on. Add two HIVEMIND bots for a full 4-player board, or play quick with 2 tokens each.", art: ART.ludo },
  { href: "/games/dots", icon: Grid3x3, title: "Dots & Boxes", who: "vs bot or a friend online", tag: "Close a box, go again. Sneaky.", about: "Draw lines between dots, close a box to claim it and go again. Simple to learn, sneaky to master: don't hand your opponent a chain of boxes.", art: ART.dots },
  { href: "/games/draw", icon: PenLine, title: "Draw & Guess", who: "2 players + HIVEMIND", tag: "One draws, everyone guesses. HIVEMIND too.", about: "Send a friend a link. One draws, the other guesses, and HIVEMIND guesses too from the drawing. Voice on, so you can laugh at each other's art.", art: ART.draw },
];

export default function GamesPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="Play" title="Games" subtitle="Quick games inside HIVEMIND, by tap or by voice." />

      {/* the featured one: game night with friends */}
      <Link
        href={NIGHT.href}
        title={NIGHT.about}
        className="group relative mb-5 block overflow-hidden rounded-2xl border border-core/40 bg-[radial-gradient(circle_at_85%_20%,oklch(0.75_0.15_75/0.35),transparent_55%),linear-gradient(135deg,oklch(0.3_0.06_60),oklch(0.2_0.03_260))] p-6 transition hover:border-core/70 sm:p-8"
      >
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-md">
            <p className="flex items-center gap-2 font-mono text-[10.5px] tracking-[0.2em] text-core uppercase">
              <Users size={13} /> Featured · {NIGHT.who}
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">{NIGHT.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-soft">{NIGHT.tag}</p>
            <span className="mt-4 inline-flex items-center gap-2 rounded-lg bg-core px-4 py-2 text-sm font-medium text-core-ink transition group-hover:brightness-110">
              Start game night <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
            </span>
          </div>
          {/* the games it can switch between */}
          <div className="flex -space-x-3" aria-hidden>
            {[ART.cards, ART.ludo, ART.business, ART.snakes, ART.draw, ART.dots, ART.chess].map((a, i) => (
              <span key={i} className="size-12 rounded-xl border-2 border-[oklch(0.22_0.03_250)] shadow-lg transition-transform group-hover:-translate-y-1" style={{ ...a, transitionDelay: `${i * 30}ms` }} />
            ))}
          </div>
        </div>
      </Link>

      <div className="list-in grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {GAMES.map((g) => (
          <Link key={g.href} href={g.href} title={g.about} className="lift group flex flex-col overflow-hidden rounded-xl border border-line bg-panel transition-colors hover:border-core/60">
            {/* banner: the game's own look */}
            <span className="relative block h-24 overflow-hidden" style={g.art}>
              <span className="absolute inset-0 bg-gradient-to-t from-[oklch(0.17_0.012_250)] via-transparent to-transparent" />
              <span className="absolute bottom-2.5 left-3 grid size-10 place-items-center rounded-lg border border-white/15 bg-black/45 text-white backdrop-blur-sm">
                <g.icon size={19} />
              </span>
            </span>
            <span className="flex flex-1 flex-col p-4 pt-3">
              <span className="text-[15px] font-semibold group-hover:text-core">{g.title}</span>
              <span className="mt-0.5 font-mono text-[10px] tracking-wider text-faint uppercase">{g.who}</span>
              <span className="mt-2 text-sm leading-snug text-soft">{g.tag}</span>
              <span className="mt-3 inline-flex items-center gap-1.5 self-start rounded-full border border-line px-2.5 py-1 text-xs text-soft transition group-hover:border-core/60 group-hover:text-core">
                <Play size={11} /> Play
              </span>
            </span>
          </Link>
        ))}
      </div>
      <GameRecord />
    </div>
  );
}
