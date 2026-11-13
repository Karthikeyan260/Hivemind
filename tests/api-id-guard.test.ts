import { describe, expect, it, vi } from "vitest";
import { handle } from "@/lib/api";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = new Request("http://x/api/notes/1");

describe("handle: ids in the address", () => {
  it("lets real ids through to the route", async () => {
    const fn = vi.fn(async (...args: [Request, { params: Promise<{ id: string }> }]) => new Response(String(args.length)));
    const route = handle(fn);
    for (const id of ["00000000-0000-4000-8000-000000000000", "a1b2c3d4-e5f6", "abc_DEF-123"]) {
      expect((await route(req, ctx(id))).status).toBe(200);
    }
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("answers 404 for an id with quotes, spaces, slashes or dots, without running the route", async () => {
    const fn = vi.fn(async (...args: [Request, { params: Promise<{ id: string }> }]) => new Response(String(args.length)));
    const route = handle(fn);
    for (const id of ["' OR 1=1--", "../auth/sessions", "..%2fauth%2fsecrets", "a b", "x;drop table notes", "<script>", "", "a".repeat(81)]) {
      const res = await route(req, ctx(id));
      expect(res.status, id).toBe(404);
      expect(await res.json()).toEqual({ error: "Not found" });
    }
    expect(fn).not.toHaveBeenCalled();
  });

  it("routes without an id are untouched", async () => {
    const route = handle(async (...args: [Request]) => new Response(String(args.length)));
    expect((await route(req)).status).toBe(200);
    const withOther = handle(async (...args: [Request, { params: Promise<{ room: string }> }]) => new Response(String(args.length)));
    expect((await withOther(req, { params: Promise.resolve({ room: "any thing" }) })).status).toBe(200);
  });
});
