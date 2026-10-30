import { afterEach, describe, expect, it, vi } from "vitest";
import { GardenScene } from "@/components/garden/garden-scene";

const w = globalThis as unknown as { window?: unknown; navigator?: unknown };
const realWindow = w.window;
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

function pretend(xr: unknown, secure = true) {
  w.window = { isSecureContext: secure };
  Object.defineProperty(globalThis, "navigator", { value: { xr }, configurable: true });
}

describe("AR is only offered where it can work", () => {
  afterEach(() => {
    w.window = realWindow;
    if (realNavigator) Object.defineProperty(globalThis, "navigator", realNavigator);
    vi.restoreAllMocks();
  });

  it("no on a computer or phone without WebXR", async () => {
    pretend(undefined);
    expect(await GardenScene.arSupported()).toBe(false);
  });
  it("yes when the phone says it can do immersive AR", async () => {
    pretend({ isSessionSupported: async (mode: string) => mode === "immersive-ar" });
    expect(await GardenScene.arSupported()).toBe(true);
  });
  it("no when it says it can't, or errors", async () => {
    pretend({ isSessionSupported: async () => false });
    expect(await GardenScene.arSupported()).toBe(false);
    pretend({ isSessionSupported: async () => { throw new Error("nope"); } });
    expect(await GardenScene.arSupported()).toBe(false);
  });
  it("no on a page that isn't secure (the camera needs https)", async () => {
    pretend({ isSessionSupported: async () => true }, false);
    expect(await GardenScene.arSupported()).toBe(false);
  });
  it("no on the server", async () => {
    w.window = undefined;
    expect(await GardenScene.arSupported()).toBe(false);
  });
});
