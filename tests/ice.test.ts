import { describe, expect, it } from "vitest";
import { cleanIceServers } from "@/lib/ice";

describe("relay list from the server", () => {
  it("keeps stun/turn urls and a matching login, drops everything else", () => {
    const out = cleanIceServers([
      { urls: ["stun:stun.cloudflare.com:3478", "javascript:alert(1)"] },
      { urls: "turn:turn.example.com:3478?transport=udp", username: "u", credential: "p" },
      { urls: ["turns:turn.example.com:443?transport=tcp"], username: "u" },
      { urls: [] },
      "nonsense",
      null,
    ]);
    expect(out).toEqual([{ urls: ["stun:stun.cloudflare.com:3478"] }, { urls: ["turn:turn.example.com:3478?transport=udp"], username: "u", credential: "p" }, { urls: ["turns:turn.example.com:443?transport=tcp"] }]);
  });
  it("is empty for anything that isn't a list", () => {
    expect(cleanIceServers(undefined)).toEqual([]);
    expect(cleanIceServers({ urls: "turn:x" })).toEqual([]);
  });
});
