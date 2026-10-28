import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { dbError, dbFault } from "@/lib/api";

describe("what a database error means to the caller", () => {
  it("a malformed id is 'not found', not a server error", () => {
    const e = dbFault({ message: 'invalid input syntax for type uuid: "abc"', code: "22P02" });
    expect(e.status).toBe(404);
  });
  it("text the database can't store is a 400", () => {
    expect(dbFault({ message: "unsupported Unicode escape sequence", code: "22P05" }).status).toBe(400);
    expect(dbFault({ message: "invalid byte sequence for encoding UTF8: 0x00" }).status).toBe(400);
  });
  it("anything else stays a 500", () => {
    expect(dbFault({ message: "connection reset", code: "08006" }).status).toBe(500);
    expect(dbFault({ message: "boom" }).status).toBe(500);
  });
  it("dbError throws that, and nothing when there's no error", () => {
    expect(() => dbError(null)).not.toThrow();
    expect(() => dbError({ message: "x", code: "22P02" })).toThrow("Not found");
  });
});
