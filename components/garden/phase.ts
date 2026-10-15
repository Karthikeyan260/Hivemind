/** The light of the day in the garden: dawn, day, golden hour, dusk, night. */
export type Phase = "dawn" | "day" | "golden" | "dusk" | "night";

export function phaseNow(d = new Date()): Phase {
  const h = d.getHours() + d.getMinutes() / 60;
  if (h < 6 || h >= 19) return "night";
  if (h < 7.5) return "dawn";
  if (h < 16) return "day";
  if (h < 18) return "golden";
  return "dusk";
}
