import { describe, expect, it } from "vitest";
import { instantAnswer } from "@/lib/agents/instant";

const tool = (m: string) => instantAnswer(m)?.tool ?? null;

describe("instant answers (no AI)", () => {
  it("answers the everyday questions straight from the data", () => {
    expect(tool("my live location")).toBe("where_am_i");
    expect(tool("Where am I?")).toBe("where_am_i");
    expect(tool("hey hivemind, which area is this")).toBe("where_am_i");
    expect(tool("what's the weather")).toBe("get_weather");
    expect(tool("weather today")).toBe("get_weather");
    expect(tool("how's the weather in Madurai?")).toBe("get_weather");
    expect(tool("is it raining")).toBe("get_weather");
    expect(tool("what are my habits today")).toBe("habits_status");
    expect(tool("my habits")).toBe("habits_status");
    expect(tool("how is my pet")).toBe("my_pet");
    expect(tool("Nova, how's Nova doing?")).toBe("my_pet");
  });
  it("leaves anything more to the agents", () => {
    expect(tool("what's the weather tomorrow in Ooty for my trip")).toBeNull();
    expect(tool("remember my location is Chennai")).toBeNull();
    expect(tool("add a habit to walk at 7")).toBeNull();
    expect(tool("why is my pet sad")).toBeNull();
    expect(tool("where is the nearest ATM")).toBeNull();
  });
  it("names the place asked about", () => {
    const w = instantAnswer("weather in madurai");
    expect(w?.tool).toBe("get_weather");
  });
});
