import "server-only";
import { obj, S, str } from "./shared";
import type { Tool } from "../types";

/** Music and video. */
export const media: Record<string, Tool> = {
  /* ───── music (plays in the owner's browser: the request is handed to the on-screen player) ───── */
  play_music: {
    name: "play_music",
    description:
      "Play music in HIVEMIND's own player on the owner's device (full songs, no ads, every Indian language). Use for ANY request to play / hear a song, artist, film's songs or mood, and for next / previous / pause / resume / stop. NEVER use web_task, YouTube or Spotify links for music. action: play (with query: starts now, replaces the queue), add (with query: queues the song to play after the current one finishes, without stopping it; use for 'play X next', 'queue X', 'after this song play X', 'once this finishes play X'), next, previous, pause, resume, stop. When the owner complains about what played ('it's not an Ilaiyaraaja song', 'that's not Vijay'), they STILL WANT that artist: play again with the artist kept and spelled properly ('Ilaiyaraaja motivational songs'). 'no song playing' / 'play' after a request = play the same request again. NOT for 'music lights on/off' or 'lights off' (the screen glow): that's screen_effects, and the music keeps playing.",
    parameters: obj({ action: { type: "string", enum: ["play", "add", "next", "previous", "pause", "resume", "stop"] }, query: S }, ["action"]),
    async run(args, ctx) {
      const action = str(args.action) || "play";
      const query = str(args.query);
      if ((action === "play" || action === "add") && !query) return { error: "Say what to play." };
      ctx.actions.push({ label: query ? `♪ ${query}` : `♪ ${action}`, href: `music:${encodeURIComponent(JSON.stringify({ action, query }))}` });
      return { done: action, query, note: "It plays in the music bar at the bottom of the screen. Say the song request in a few words; don't add links." };
    },
  },

  screen_effects: {
    name: "screen_effects",
    description:
      "Turn one of HIVEMIND's screen effects on or off. Each is separate, change only the one asked for: music_lights (the app glowing with the beat of the song playing; 'lights off', 'music lights off'), weather (rain / lightning / sunshine / night stars over the app; 'weather effects off', 'stop the rain on screen'), pet_voice (the pet Nova speaking out loud; 'Nova be quiet', 'Nova you can talk'), lantern_walk (the pet's game: the screen goes dark and you find sparks with its light; 'Nova, lights off' / 'lantern walk' = on, 'Nova, lights on' / 'stop the walk' = off). Never a routine, and never stops the music. The music lights can be any colour: 'make the music lights blue / pink / rainbow / #ff00aa', 'use the song's colour' (= auto): pass color (with effect music_lights, on true).",
    parameters: obj({ effect: { type: "string", enum: ["music_lights", "weather", "pet_voice", "lantern_walk"] }, on: { type: "boolean" }, color: { type: "string", description: "Only for music_lights: a colour name (gold, orange, red, pink, purple, blue, cyan, green, yellow, white), a #hex colour, 'rainbow', or 'auto' (the song's cover)." } }, ["effect", "on"]),
    async run(args, ctx) {
      // "lights" (older wording) = the music lights only.
      const asked = String(args.effect) === "lights" ? "music_lights" : String(args.effect);
      const effect = ["music_lights", "weather", "pet_voice", "lantern_walk"].includes(asked) ? asked : "music_lights";
      const on = args.on === true || args.on === "true";
      const { colorFromWords } = await import("@/lib/beat-color");
      const color = typeof args.color === "string" && args.color.trim() ? colorFromWords(args.color) : null;
      if (typeof args.color === "string" && args.color.trim() && !color) return { error: `I don't know the colour "${args.color}". Try a name like blue or pink, a #hex colour, rainbow or auto.` };
      const label = { music_lights: "Music lights", weather: "Weather effects", pet_voice: "Nova's voice", lantern_walk: "Lantern walk" }[effect];
      ctx.actions.push({ label: `${on ? "✨" : "🌙"} ${label} ${color ? color : on ? "on" : "off"}`, href: `fx:${encodeURIComponent(JSON.stringify({ effect, on: color ? true : on, ...(color ? { color } : {}) }))}` });
      return { done: color ? `Music lights are now ${color}` : `${label} turned ${on ? "on" : "off"} on this screen`, note: "It's a setting of this device's screen; the music (if any) keeps playing." };
    },
  },

  play_video: {
    name: "play_video",
    description:
      "Play a video in HIVEMIND's video window on the owner's screen (YouTube's player, free): trailers, video songs, how-tos, clips. Also next / previous / pause / resume / close / fullscreen. NEVER use web_task or links for videos. action: play (with query), add (play next), next, previous, pause, resume, stop, fullscreen.",
    parameters: obj({ action: { type: "string", enum: ["play", "add", "next", "previous", "pause", "resume", "stop", "fullscreen"] }, query: S }, ["action"]),
    async run(args, ctx) {
      const action = str(args.action) || "play";
      const query = str(args.query);
      if ((action === "play" || action === "add") && !query) return { error: "Say what to watch." };
      ctx.actions.push({ label: query ? `▶ ${query}` : `▶ ${action}`, href: `video:${encodeURIComponent(JSON.stringify({ action, query }))}` });
      return { done: action, query, note: "It opens in the video window on screen. Say it in a few words; don't add links." };
    },
  },
};
