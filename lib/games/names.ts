/** Every game that can be recorded, by its id: the name people see, and the gem colour it grows in the garden. */
export const GAME_NAMES: Record<string, string> = {
  chess: "Chess",
  cards: "Colour Clash",
  ludo: "Ludo",
  draw: "Draw & Guess",
  dots: "Dots & Boxes",
  snakes: "Snakes & Ladders",
  business: "Business",
  bingo: "Bingo",
  connect4: "Connect Four",
};
export const GAME_HUES: Record<string, number> = { chess: 200, cards: 330, ludo: 45, draw: 280, dots: 150, snakes: 120, business: 30, bingo: 260, connect4: 220 };
/** A game's display name; an unknown id is shown as it is. */
export const gameName = (id: string) => GAME_NAMES[id] ?? id;
