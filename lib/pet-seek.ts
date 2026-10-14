/** Hide and seek with Nova: whether a spoken guess found where it's hiding. */
export type HideSpot = { name: string; row: "top" | "middle" | "bottom"; col: "left" | "center" | "right" };

const IGNORE = new Set(["the", "near", "behind", "under", "over", "are", "you", "nova", "is", "it", "in", "on", "at", "there", "here", "side", "corner", "of", "a", "an", "to", "by", "next", "ah", "da", "inga", "anga"]);

/** Did the guess find it? "found" (the thing it hides behind, or both row and column), "warm" (half right) or "cold". */
export function judgeGuess(said: string, spot: HideSpot): "found" | "warm" | "cold" {
  const t = said.toLowerCase();
  const nameWords = spot.name.toLowerCase().split(/[^a-z0-9஀-௿]+/).filter((w) => w.length >= 3);
  const words = t.split(/[^a-z0-9஀-௿]+/).filter((w) => w.length >= 3 && !IGNORE.has(w));
  if (words.some((w) => nameWords.some((n) => n === w || (w.length >= 4 && (n.startsWith(w) || w.startsWith(n)))))) return "found";
  const row = /\b(top|up|upper|mela)\b/.test(t) ? "top" : /\b(bottom|down|lower|keela|kela)\b/.test(t) ? "bottom" : /\b(middle|centre|center|naduvula|nadu)\b/.test(t) ? "middle" : null;
  const col = /\b(left|idathu|idadhu)\b/.test(t) ? "left" : /\b(right|valathu|valadhu)\b/.test(t) ? "right" : null;
  const rowOk = row === spot.row;
  const colOk = col === spot.col || (!col && spot.col === "center");
  if ((row || col) && rowOk && colOk) return "found";
  if ((row && rowOk) || (col && col === spot.col)) return "warm";
  return "cold";
}
