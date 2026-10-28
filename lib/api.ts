import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid input", issues: err.issues }, { status: 400 });
      }
      console.error(err instanceof Error ? err.message : err);
      return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
    }
  };
}

export async function parseBody<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "Body must be JSON");
  }
  return schema.parse(body);
}

/** What the database's complaint means for the caller (not every one is the server's fault). */
export function dbFault(error: { message: string; code?: string }): HttpError {
  // An id in the address that isn't a real id (22P02 invalid text representation): nothing is there.
  if (error.code === "22P02") return new HttpError(404, "Not found");
  // Text the database can't store (a NUL character, 22P05 / 22021): the request is wrong, not the server.
  if (error.code === "22P05" || error.code === "22021" || /unsupported Unicode escape|invalid byte sequence/i.test(error.message)) return new HttpError(400, "That text has characters I can't store.");
  return new HttpError(500, "Database error");
}

export function dbError(error: { message: string; code?: string } | null) {
  if (error) {
    const fault = dbFault(error);
    // Only a real server-side failure is worth a log line.
    if (fault.status >= 500) console.error("db:", error.message);
    throw fault;
  }
}

export const toVector = (v: number[]) => JSON.stringify(v);
