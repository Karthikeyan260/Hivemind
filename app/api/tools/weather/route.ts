import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { getWeather, HOME_CITY } from "@/lib/external/weather";

/** Live weather + 4-day forecast (Open-Meteo). ?place=Chennai */
export const GET = handle(async (req: Request) => {
  const place = new URL(req.url).searchParams.get("place") || HOME_CITY;
  return NextResponse.json(await getWeather(place));
});
