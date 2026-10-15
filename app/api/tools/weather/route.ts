import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { getWeather, getWeatherAt, HOME_CITY } from "@/lib/external/weather";

/** Live weather + 4-day forecast (Open-Meteo). ?place=Chennai, or ?lat=13.08&lng=80.27 (where the device is). */
export const GET = handle(async (req: Request) => {
  const q = new URL(req.url).searchParams;
  if (q.has("lat") && q.has("lng")) return NextResponse.json(await getWeatherAt(Number(q.get("lat")), Number(q.get("lng"))));
  const place = q.get("place") || HOME_CITY;
  return NextResponse.json(await getWeather(place));
});
