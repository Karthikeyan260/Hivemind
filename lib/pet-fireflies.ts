/**
 * Catch fireflies: a 30-second tapping game with Nova. Fireflies drift across the screen and fade
 * out; tap one to catch it (golden ones are worth three). Pure, so it can be tested: the screen
 * only draws the state and passes taps in.
 */
export const GAME_MS = 30_000;
export const MAX_FLIES = 7;
/** Fireflies live this long (ms) before they fade away. */
export const LIFE_MS = 4200;
export const GOLD_POINTS = 3;

export type Fly = {
  id: number;
  /** Position as a share of the play area, 0..1 each way. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  gold: boolean;
  /** How long it has been alive (ms). */
  age: number;
};
export type FlyGame = { t: number; score: number; caught: number; flies: Fly[]; nextSpawn: number; nextId: number; over: boolean };

export const newFlyGame = (): FlyGame => ({ t: 0, score: 0, caught: 0, flies: [], nextSpawn: 300, nextId: 1, over: false });

/** How long until the next one appears: quicker as the game goes on (ms). */
export const spawnGap = (t: number) => Math.max(380, 900 - (t / GAME_MS) * 520);

/** Moves the game on by `dt` ms: fireflies drift (wandering a little), age and fade; new ones appear. */
export function tickFlies(g: FlyGame, dt: number, rand: () => number = Math.random): FlyGame {
  if (g.over) return g;
  const t = Math.min(GAME_MS, g.t + dt);
  const step = dt / 1000;
  const flies = g.flies
    .map((f) => {
      // A little wander in the heading, and a bounce off the edges.
      const turn = (rand() - 0.5) * 1.6 * step;
      const vx = f.vx * Math.cos(turn) - f.vy * Math.sin(turn);
      const vy = f.vx * Math.sin(turn) + f.vy * Math.cos(turn);
      let x = f.x + vx * step;
      let y = f.y + vy * step;
      let nvx = vx;
      let nvy = vy;
      if (x < 0.04 || x > 0.96) {
        nvx = -nvx;
        x = Math.min(0.96, Math.max(0.04, x));
      }
      if (y < 0.1 || y > 0.9) {
        nvy = -nvy;
        y = Math.min(0.9, Math.max(0.1, y));
      }
      return { ...f, x, y, vx: nvx, vy: nvy, age: f.age + dt };
    })
    .filter((f) => f.age < LIFE_MS);
  let { nextSpawn, nextId } = g;
  while (t >= nextSpawn && flies.length < MAX_FLIES && t < GAME_MS) {
    const a = rand() * Math.PI * 2;
    const speed = 0.07 + rand() * 0.09;
    const gold = rand() < 0.12;
    flies.push({ id: nextId++, x: 0.1 + rand() * 0.8, y: 0.15 + rand() * 0.7, vx: Math.cos(a) * speed * (gold ? 1.7 : 1), vy: Math.sin(a) * speed * (gold ? 1.7 : 1), gold, age: 0 });
    nextSpawn += spawnGap(nextSpawn);
  }
  // A full sky waits: the next one comes a moment after a gap opens.
  if (t >= nextSpawn) nextSpawn = t + 200;
  return { ...g, t, flies, nextSpawn, nextId, over: t >= GAME_MS };
}

/** Taps a firefly: it is caught (its points are added). A tap that finds nothing, or a finished game, changes nothing. */
export function catchFly(g: FlyGame, id: number): { game: FlyGame; points: number } {
  if (g.over) return { game: g, points: 0 };
  const f = g.flies.find((x) => x.id === id);
  if (!f) return { game: g, points: 0 };
  const points = f.gold ? GOLD_POINTS : 1;
  return { game: { ...g, score: g.score + points, caught: g.caught + 1, flies: g.flies.filter((x) => x.id !== id) }, points };
}

/** What Nova says about a score (Tanglish, short). */
export function flyLine(score: number, best: number, newBest: boolean) {
  if (newBest && best > 0 && score > 0) return `Puthu record! ${score} fireflies points ✨🏆`;
  if (score >= 30) return `${score}! Neenga firefly master 🌟`;
  if (score >= 15) return `${score} pidichuteenga, semma! ✨`;
  if (score >= 5) return `${score} points. Innoru round poddaalaam? 😄`;
  return "Konjam slow… innoru thadavai try pannunga 🐛";
}
