/**
 * How two browsers find a path to each other for game night, friend games and calls. A direct path often
 * isn't possible (two devices on one network, a phone on mobile data, a strict router), and then the
 * traffic has to be relayed, which needs a TURN server. PeerJS's own free relay speaks only plain UDP on
 * port 3478, which many networks block, so this adds more STUN servers and a free public relay that also
 * works over TCP and port 443. A relay carries the game's packets only; it can't read anything but who is
 * talking to whom. To use your own relay, set NEXT_PUBLIC_TURN_URL, NEXT_PUBLIC_TURN_USER and
 * NEXT_PUBLIC_TURN_PASS. Better: set up a Cloudflare or Metered relay on the server (see app/api/ice): the browser asks
 * /api/ice for fresh relay logins when the page opens and uses them for every connection made after that.
 */
export type IceServer = { urls: string | string[]; username?: string; credential?: string };

const OWN_URL = process.env.NEXT_PUBLIC_TURN_URL;

export const ICE_SERVERS: IceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun.cloudflare.com:3478"] },
  // The owner's own relay, when one is set up.
  ...(OWN_URL ? [{ urls: OWN_URL.split(","), username: process.env.NEXT_PUBLIC_TURN_USER, credential: process.env.NEXT_PUBLIC_TURN_PASS }] : []),
  // PeerJS's own free relay (plain UDP).
  { urls: ["turn:eu-0.turn.peerjs.com:3478", "turn:us-0.turn.peerjs.com:3478"], username: "peerjs", credential: "peerjsp" },
  // A free public relay that also works over TCP and 443, for networks that block UDP.
  {
    urls: ["turn:openrelay.metered.ca:80", "turn:openrelay.metered.ca:443", "turn:openrelay.metered.ca:443?transport=tcp", "turns:openrelay.metered.ca:443?transport=tcp"],
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

/** What /api/ice sent, if it is well-formed: urls, and a login when it is a relay. Anything else is dropped. */
export function cleanIceServers(v: unknown): IceServer[] {
  if (!Array.isArray(v)) return [];
  const out: IceServer[] = [];
  for (const s of v.slice(0, 8)) {
    const urls = (s as IceServer | null)?.urls;
    const list = (Array.isArray(urls) ? urls : [urls]).filter((u): u is string => typeof u === "string" && /^(stun|turn|turns):/.test(u)).slice(0, 8);
    if (!list.length) continue;
    const { username, credential } = s as IceServer;
    out.push({ urls: list, ...(typeof username === "string" && typeof credential === "string" ? { username: username.slice(0, 300), credential: credential.slice(0, 300) } : {}) });
  }
  return out;
}

/** The options for `new Peer(id, PEER_OPTIONS)` / `new Peer(PEER_OPTIONS)`. The server list is swapped in (same array) as soon as it arrives. */
export const PEER_OPTIONS = { config: { iceServers: ICE_SERVERS, sdpSemantics: "unified-plan" } };

/** Asks the server for relay logins (a Cloudflare or Metered relay set up by the owner) and puts them first. Safe to fail: the fixed list above still works. */
let asked = false;
export function loadRelays() {
  if (asked || typeof window === "undefined") return;
  asked = true;
  void fetch("/api/ice", { cache: "no-store", signal: AbortSignal.timeout(6000) })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { iceServers?: unknown } | null) => {
      const mine = cleanIceServers(j?.iceServers);
      // Same array object, so connections made from now on use it.
      if (mine.length) ICE_SERVERS.splice(0, ICE_SERVERS.length, ...mine, ...ICE_SERVERS.filter((s) => !JSON.stringify(mine).includes(JSON.stringify(s.urls))));
    })
    .catch(() => {});
}
if (typeof window !== "undefined") loadRelays();
