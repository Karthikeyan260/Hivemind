import "server-only";
import { chunkText } from "@/lib/rag/chunker";

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // Vercel request body limit is ~4.5MB
export const ALLOWED_TYPES = ["pdf", "txt", "md", "docx", "csv"] as const;
export type DocType = (typeof ALLOWED_TYPES)[number];

export function detectType(filename: string): DocType | null {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "markdown") return "md";
  return (ALLOWED_TYPES as readonly string[]).includes(ext ?? "") ? (ext as DocType) : null;
}

export type ParsedChunk = { content: string; metadata: { page?: number } };

export async function parseToChunks(buf: Buffer, type: DocType): Promise<ParsedChunk[]> {
  if (type === "pdf") {
    const { getDocumentProxy, extractText } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: false });
    return text.flatMap((pageText, i) =>
      chunkText(pageText).map((content) => ({ content, metadata: { page: i + 1 } })),
    );
  }
  if (type === "docx") {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return chunkText(value).map((content) => ({ content, metadata: {} }));
  }
  return chunkText(buf.toString("utf8")).map((content) => ({ content, metadata: {} }));
}
