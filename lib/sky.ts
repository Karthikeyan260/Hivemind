/**
 * The living sky: what the app's screen shows for the weather outside right now (Open-Meteo's WMO
 * weather code + day/night). Pure, shared by the sky effect and the pet.
 */
export type Sky = "thunder" | "rain" | "sunny" | "night" | "calm";

export const SKY_EVENT = "hivemind:sky";
export const THUNDER_EVENT = "hivemind:thunder";
export const SKIES: Sky[] = ["thunder", "rain", "sunny", "night", "calm"];

export function skyFor(code: number, isDay: boolean, rainMm = 0): Sky {
  if (code >= 95) return "thunder";
  // Drizzle, rain, freezing rain, showers; or rain falling right now whatever the code says.
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || rainMm >= 0.3) return "rain";
  if (!isDay) return "night";
  if (code <= 1) return "sunny";
  return "calm";
}

/** "show me rain" / "make it sunny" → which sky to preview. */
export function skyFromWords(said: string): Sky | null {
  const t = said.toLowerCase();
  if (/thunder|storm|lightning|idi|minnal/.test(t)) return "thunder";
  if (/rain|mazhai|drizzle|shower/.test(t)) return "rain";
  if (/sun|veyil|hot|clear day/.test(t)) return "sunny";
  if (/night|star|firefl|iravu/.test(t)) return "night";
  if (/calm|cloud|normal|plain/.test(t)) return "calm";
  return null;
}
