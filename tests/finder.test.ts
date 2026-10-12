import { describe, expect, it } from "vitest";
import { isRingUrl, parsePing } from "@/lib/finder";

describe("find my device: check-ins from the helper app", () => {
  it("reads MacroDroid's 'lat,lng' and the extras", () => {
    expect(parsePing({ loc: "13.04012345,80.23398765", acc: "18", bat: "54", power: "On", event: "power off" })).toEqual({ lat: 13.040123, lng: 80.233988, acc: 18, battery: 54, charging: true, event: "power off" });
  });
  it("reads separate lat / lng, and a battery with a % sign", () => {
    expect(parsePing({ lat: "13.04", lng: "80.23", battery: "7%" })).toEqual({ lat: 13.04, lng: 80.23, battery: 7 });
  });
  it("refuses a request without a real location", () => {
    expect(parsePing({ loc: "[last_loc_latlong]" })).toBeNull(); // the helper app didn't fill it in
    expect(parsePing({ lat: "0", lng: "0" })).toBeNull();
    expect(parsePing({ lat: "95", lng: "10" })).toBeNull();
    expect(parsePing({})).toBeNull();
  });
  it("drops odd values instead of storing them", () => {
    expect(parsePing({ loc: "13,80", bat: "250", acc: "-3", event: "<script>" })).toEqual({ lat: 13, lng: 80, event: "script" });
  });
  it("only calls MacroDroid's own webhook host for a loud ring", () => {
    expect(isRingUrl("https://trigger.macrodroid.com/8a1b2c3d-4e5f-6789-abcd-ef0123456789/ring")).toBe(true);
    expect(isRingUrl("http://trigger.macrodroid.com/abcdef/ring")).toBe(false);
    expect(isRingUrl("https://trigger.macrodroid.com.evil.com/abcdef/ring")).toBe(false);
    expect(isRingUrl("https://169.254.169.254/latest/meta-data")).toBe(false);
  });
});
