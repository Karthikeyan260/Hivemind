import "server-only";
import { NO_LOCATION, obj, S, str } from "./shared";
import type { Tool } from "../types";

/** Location and maps. */
export const places: Record<string, Tool> = {
  /* ───── location: the device asking sends where it is (ctx.location) ───── */
  where_am_i: {
    name: "where_am_i",
    description: "Where the owner is right now (the device they're asking from): the address in words. Use for 'where am I', 'which area is this', 'my location'.",
    parameters: obj({}),
    async run(_args, ctx) {
      const at = ctx.location;
      if (!at) return { error: NO_LOCATION };
      const { whereIs } = await import("@/lib/places");
      const w = await whereIs(at);
      ctx.actions.push({ label: "Open map", href: "/map" });
      return {
        address: w.address,
        area: w.area,
        city: w.city,
        device: at.device,
        accuracy: at.accuracy && at.accuracy > 200 ? `approximate (within about ${Math.round(at.accuracy / 100) / 10} km: this device has no GPS)` : "precise",
      };
    },
  },
  places_nearby: {
    name: "places_nearby",
    description:
      "Places near the owner right now, nearest first, with distance and walking time: parks, ATMs, petrol bunks, hospitals, medical shops, restaurants, tea shops, cinemas, temples, bus stops, metro… 'what' = the kind of place. Shows them on the map.",
    parameters: obj({ what: S, radius_km: { type: "number" } }, ["what"]),
    async run(args, ctx) {
      const at = ctx.location;
      if (!at) return { error: NO_LOCATION };
      const what = str(args.what);
      const { nearby } = await import("@/lib/places");
      const places = await nearby(what, at, Math.min(10, Math.max(0.5, Number(args.radius_km) || 3)));
      ctx.actions.push({ label: `Map: ${what} near you`, href: `/map?near=${encodeURIComponent(what)}`, navigate: true });
      if (!places.length) return { found: 0, note: `No ${what} found within ${Number(args.radius_km) || 3} km on OpenStreetMap. Try a bigger radius or another word.` };
      return { found: places.length, places: places.slice(0, 6).map((p) => ({ name: p.name, distance_km: p.km, walk_minutes: p.walk_min, address: p.address })) };
    },
  },
  directions: {
    name: "directions",
    description:
      "How far a place is and the way there from where the owner is now ('how far is AGS Villivakkam', 'way to Anna Nagar tower park', 'how do I walk to the metro'). mode: car (default) or walk. Opens the route on the map, with a button for turn-by-turn navigation in Google Maps.",
    parameters: obj({ to: S, mode: { type: "string", enum: ["car", "walk"] } }, ["to"]),
    async run(args, ctx) {
      const at = ctx.location;
      if (!at) return { error: NO_LOCATION };
      const to = str(args.to);
      const mode = str(args.mode) === "walk" ? "walk" : "car";
      const { findPlace, navigateLink, route } = await import("@/lib/places");
      const dest = await findPlace(to, at);
      if (!dest) return { error: `Couldn't find "${to}" on the map. Try the full name and area.` };
      const r = await route(at, dest, mode);
      ctx.actions.push({ label: `Map: way to ${dest.name}`, href: `/map?to=${encodeURIComponent(to)}&mode=${mode}`, navigate: true });
      ctx.actions.push({ label: "Start navigation (Google Maps)", href: navigateLink(at, dest, mode) });
      return {
        destination: `${dest.name}, ${dest.address}`,
        distance_km: r.km,
        minutes: r.minutes,
        by: mode === "walk" ? "walking" : "car / bike (time allows for city traffic)",
        first_steps: r.steps.slice(0, 4).map((s) => `${s.text}${s.km >= 0.1 ? ` (${s.km} km)` : ""}`),
        note: "The route is on the map; the Start navigation button gives live turn-by-turn in Google Maps.",
      };
    },
  },
  device_locations: {
    name: "device_locations",
    description: "Where the owner's devices last were ('where's my phone', 'where is my laptop'), from devices with location sharing on.",
    parameters: obj({}),
    async run(_args, ctx) {
      const [{ listDevices }, { listFinder }, { whereIs }] = await Promise.all([import("@/lib/device-location"), import("@/lib/finder"), import("@/lib/places")]);
      const [shared, finder] = await Promise.all([listDevices(ctx.supabase), listFinder(ctx.supabase).catch(() => [])]);
      // Devices with the helper app (they check in even with HIVEMIND closed), then browsers sharing location.
      const all = [
        ...finder.filter((d) => d.last).map((d) => ({ name: d.name, lat: d.last!.lat, lng: d.last!.lng, accuracy: d.last!.acc ?? 50, at: d.last!.at, battery: d.last!.battery, lost: !!d.lost })),
        ...shared.map((d) => ({ name: d.name, lat: d.lat, lng: d.lng, accuracy: d.accuracy, at: d.at, battery: undefined as number | undefined, lost: false })),
      ].sort((a, b) => b.at.localeCompare(a.at));
      if (!all.length) return { error: "No device has checked in yet. Set one up on the Find devices page (the helper app works even with HIVEMIND closed)." };
      ctx.actions.push({ label: "Find devices", href: "/find", navigate: true });
      return {
        devices: await Promise.all(
          all.slice(0, 5).map(async (d) => ({
            device: d.name,
            near: (await whereIs(d).catch(() => ({ address: "unknown" }))).address,
            last_seen_minutes_ago: Math.round((Date.now() - +new Date(d.at)) / 60_000),
            precise: d.accuracy <= 200,
            ...(d.battery !== undefined ? { battery_percent: d.battery } : {}),
            ...(d.lost ? { lost_mode: true } : {}),
          })),
        ),
      };
    },
  },
  ring_device: {
    name: "ring_device",
    description: "Ring one of the owner's devices so they can find it ('ring my phone', 'where's my phone, make it ring'). loud=true uses the helper app's alarm at full volume, even on silent; otherwise a notification with a long buzz.",
    parameters: obj({ which: { type: "string", description: "The device's name, e.g. 'phone'. Empty = the only / most recent device." }, loud: { type: "boolean" } }),
    async run(args, ctx) {
      const { listFinder, ringDevice } = await import("@/lib/finder");
      const devices = await listFinder(ctx.supabase);
      if (!devices.length) return { error: "No devices set up yet. Add one on the Find devices page." };
      const want = String(args.which ?? "").toLowerCase().trim();
      const d = (want && devices.find((x) => x.name.toLowerCase().includes(want))) || (devices.length === 1 || !want ? [...devices].sort((a, b) => (b.last?.at ?? "").localeCompare(a.last?.at ?? ""))[0] : null);
      if (!d) return { error: `Which device? You have: ${devices.map((x) => x.name).join(", ")}.` };
      const loud = args.loud === true || (!d.pushEndpoint && !!d.ringUrl);
      try {
        return await ringDevice(ctx.supabase, d.id, loud ? "loud" : "push");
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Couldn't ring it." };
      }
    },
  },
};
