/** 0 = no match; higher is better. Whole words and prefixes beat scattered letters. */
export function score(text: string, q: string) {
  const t = text.toLowerCase();
  const n = q.trim().toLowerCase();
  if (!n) return 1;
  if (t === n) return 100;
  if (t.startsWith(n)) return 80;
  if (t.split(/[\s/-]+/).some((w) => w.startsWith(n))) return 60;
  if (t.includes(n)) return 40;
  let i = 0;
  for (const c of t) if (c === n[i]) i++;
  return i === n.length && n.length > 1 ? 10 : 0;
}
