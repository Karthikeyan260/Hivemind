const TARGET = 1200;
const OVERLAP = 200;

/** Paragraph-aware chunking with a character overlap so ideas aren't cut in half. */
export function chunkText(text: string): string[] {
  const clean = text.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  if (clean.length <= TARGET) return [clean];

  const pieces = clean.split(/\n\n+/).flatMap((p) =>
    p.length <= TARGET ? [p] : p.match(/[^.!?]+[.!?]*\s*/g) ?? [p],
  );

  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (current && current.length + piece.length + 2 > TARGET) {
      chunks.push(current.trim());
      current = current.slice(-OVERLAP);
    }
    if (piece.length > TARGET) {
      for (let i = 0; i < piece.length; i += TARGET - OVERLAP) chunks.push(piece.slice(i, i + TARGET));
      current = "";
      continue;
    }
    current += (current ? "\n\n" : "") + piece;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
