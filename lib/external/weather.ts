import "server-only";
import { HttpError } from "@/lib/api";

// Open-Meteo: free, no API key, real-time conditions + forecast.
export const HOME_CITY = process.env.HOME_CITY || "Chennai";

const WMO: Record<number, string> = {
  0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "freezing fog",
  51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 61: "light rain", 63: "rain", 65: "heavy rain",
  66: "freezing rain", 67: "heavy freezing rain", 71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains",
  80: "light showers", 81: "showers", 82: "violent showers", 85: "snow showers", 86: "heavy snow showers",
  95: "thunderstorm", 96: "thunderstorm with hail", 99: "severe thunderstorm with hail",
};
const condition = (code: number) => WMO[code] ?? "unknown";

export type Weather = {
  place: string;
  region: string;
  local_time: string;
  current: { temp_c: number; feels_like_c: number; humidity_pct: number; wind_kmh: number; rain_mm: number; condition: string };
  days: { date: string; max_c: number; min_c: number; rain_chance_pct: number; condition: string }[];
};

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new HttpError(502, `Weather service error (${r.status})`);
  return r.json() as Promise<T>;
}

export async function getWeather(place = HOME_CITY): Promise<Weather> {
  type Geo = { results?: { name: string; latitude: number; longitude: number; admin1?: string; country?: string }[] };
  const geo = await json<Geo>(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(place.trim() || HOME_CITY)}`);
  const p = geo.results?.[0];
  if (!p) throw new HttpError(404, `I couldn't find a place called “${place}”.`);

  type Forecast = {
    current: { time: string; temperature_2m: number; apparent_temperature: number; relative_humidity_2m: number; weather_code: number; wind_speed_10m: number; precipitation: number };
    daily: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[]; weather_code: number[] };
  };
  const f = await json<Forecast>(
    `https://api.open-meteo.com/v1/forecast?latitude=${p.latitude}&longitude=${p.longitude}&timezone=auto&forecast_days=4` +
      "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,precipitation" +
      "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code",
  );
  const c = f.current;
  return {
    place: p.name,
    region: [p.admin1, p.country].filter(Boolean).join(", "),
    local_time: c.time,
    current: {
      temp_c: c.temperature_2m,
      feels_like_c: c.apparent_temperature,
      humidity_pct: c.relative_humidity_2m,
      wind_kmh: c.wind_speed_10m,
      rain_mm: c.precipitation,
      condition: condition(c.weather_code),
    },
    days: f.daily.time.map((date, i) => ({
      date,
      max_c: f.daily.temperature_2m_max[i],
      min_c: f.daily.temperature_2m_min[i],
      rain_chance_pct: f.daily.precipitation_probability_max[i],
      condition: condition(f.daily.weather_code[i]),
    })),
  };
}

export function weatherText(w: Weather) {
  const c = w.current;
  return [
    `Live weather for ${w.place} (${w.region}) at ${w.local_time.replace("T", " ")} local time:`,
    `${c.condition}, ${c.temp_c}°C (feels like ${c.feels_like_c}°C), humidity ${c.humidity_pct}%, wind ${c.wind_kmh} km/h, rain now ${c.rain_mm} mm.`,
    "Forecast:",
    ...w.days.map((d) => `- ${d.date}: ${d.condition}, ${d.min_c}–${d.max_c}°C, rain chance ${d.rain_chance_pct}%`),
  ].join("\n");
}
