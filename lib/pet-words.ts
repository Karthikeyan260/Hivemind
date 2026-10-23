/**
 * Nova learns the owner's way of talking: the Tanglish words they use most in their own chats (seri, da,
 * semma…) are noticed, and Nova starts dropping them into what it says. Only words from a fixed list of
 * everyday Tanglish are ever picked up (never a name, a number or anything private), counted from the
 * owner's own messages. Pure, so it can be tested.
 */
export type LearnedWord = { word: string; count: number };

/** Everyday Tanglish, each with the spellings people type (an elongated "semmaaa" counts as "semma"). */
const LEXICON: { word: string; re: RegExp }[] = [
  { word: "seri", re: /^s[ae]r[iy]+$/ },
  { word: "da", re: /^d+a+$/ },
  { word: "di", re: /^d+i+$/ },
  { word: "dei", re: /^d+ei+$/ },
  { word: "semma", re: /^s[ae]mm+a+$/ },
  { word: "machan", re: /^m+a+c+h+[ae]*n+$/ },
  { word: "macha", re: /^m+a+c+h+a+$/ },
  { word: "bro", re: /^br+o+$/ },
  { word: "ayyo", re: /^a+y+o+$/ },
  { word: "aiyo", re: /^a+i+y+o+$/ },
  { word: "enna", re: /^e+nn+a+$/ },
  { word: "illa", re: /^i+ll+a+$/ },
  { word: "aamaa", re: /^a+a*m+a+a*$/ },
  { word: "vaa", re: /^v+a+a+$/ },
  { word: "poda", re: /^p+o+d+a+$/ },
  { word: "nalla", re: /^n+a+ll+a+$/ },
  { word: "super", re: /^su+p+e+r+$/ },
  { word: "thala", re: /^th+a+l+a+$/ },
  { word: "mass", re: /^ma+ss+$/ },
  { word: "kalakkal", re: /^ka+l+a+kk+a+l+$/ },
  { word: "paavam", re: /^pa+a*v+a+m+$/ },
  { word: "sema", re: /^s+e+m+a+$/ },
  { word: "romba", re: /^ro+m+b+a+$/ },
  { word: "konjam", re: /^ko+n+j+a+m+$/ },
  { word: "appuram", re: /^a+p+u+r+a+m+$/ },
  { word: "sollu", re: /^so+ll+u+$/ },
  { word: "paaru", re: /^pa+a+r+u+$/ },
  { word: "okay", re: /^o+k+(a+y+)?$/ },
  { word: "ippo", re: /^i+pp+o+$/ },
  { word: "innum", re: /^i+nn+u+m+$/ },
  { word: "pannu", re: /^pa+nn+u+$/ },
  { word: "ponga", re: /^po+n+g+a+$/ },
];

/** The lexicon word a typed word is, or null. */
export function lexiconWord(token: string): string | null {
  const t = token.toLowerCase();
  if (t.length < 2 || t.length > 14) return null;
  for (const e of LEXICON) if (e.re.test(t)) return e.word;
  return null;
}

/** How many times a word has to be used before Nova picks it up. */
export const LEARN_AT = 3;

/** The words Nova has picked up from these messages, most-used first (at most `max`). */
export function learnWords(messages: string[], max = 8): LearnedWord[] {
  const counts = new Map<string, number>();
  for (const m of messages) {
    for (const tok of m.toLowerCase().split(/[^a-z]+/)) {
      const w = lexiconWord(tok);
      if (w) counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  return [...counts]
    .filter(([, n]) => n >= LEARN_AT)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([word, count]) => ({ word, count }));
}

/** Words that sit at the start of a line as a cheer ("Semma!"), and ones that close it ("…da?"). */
const OPENERS = new Set(["seri", "ayyo", "aiyo", "semma", "sema", "super", "mass", "kalakkal", "romba", "okay", "machan", "macha", "thala"]);
const CLOSERS = new Set(["da", "di", "dei", "machan", "macha", "bro", "thala"]);

/**
 * A line with one of the owner's own words worked in: a cheer in front or a "da" at the end, every so
 * often (not every line). `roll` gives numbers in 0..1 (random in use, fixed in tests).
 */
export function flavor(line: string, learned: LearnedWord[], roll: () => number = Math.random): string {
  if (!learned.length || roll() > 0.45) return line;
  const pool = learned.map((l) => l.word);
  const open = pool.filter((w) => OPENERS.has(w));
  const close = pool.filter((w) => CLOSERS.has(w));
  // Never twice: not on a line that already carries one of its words.
  if (pool.some((w) => new RegExp(`\\b${w}\\b`, "i").test(line))) return line;
  const pick = <T,>(a: T[]) => a[Math.floor(roll() * a.length) % a.length];
  const cap = (w: string) => w[0].toUpperCase() + w.slice(1);
  if (close.length && (!open.length || roll() < 0.5)) {
    const tail = pick(close);
    // Before the closing mark and any emoji: "Coffee kudichiya? ☕" → "Coffee kudichiya da? ☕"
    const m = /^([\s\S]*?)([?!.…]*)((?:\s*\p{Extended_Pictographic}[\p{Extended_Pictographic}\s\u200d\ufe0f]*)?)$/u.exec(line);
    return m ? `${m[1]} ${tail}${m[2]}${m[3]}` : line;
  }
  if (open.length) return `${cap(pick(open))}! ${line}`;
  return line;
}
