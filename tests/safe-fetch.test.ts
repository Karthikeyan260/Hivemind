import { describe, expect, it } from "vitest";
import { isBlockedAddress } from "@/lib/safe-fetch";

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "169.254.169.254",
    "192.168.1.1",
    "::1",
    "::ffff:a9fe:a9fe", // mapped 169.254.169.254
    "::7f00:1", // IPv4-compatible 127.0.0.1
    "64:ff9b::7f00:1", // NAT64 127.0.0.1
    "2002:7f00:1::", // 6to4 127.0.0.1
    "fe80::1",
    "not-an-ip",
  ])("blocks %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "2001:4860:4860::8888"])("allows %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });
});
