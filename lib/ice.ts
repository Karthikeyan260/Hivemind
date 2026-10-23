/**
 * How two browsers find a path to each other for game night, friend games and calls. A direct path often
 * isn't possible (two devices on one network, a phone on mobile data, a strict router), and then the
 * traffic has to be relayed, which needs a TURN server. PeerJS's own free relay speaks only plain UDP on
 * port 3478, which many networks block, so this adds more STUN servers and a free public relay that also
 * works over TCP and port 443. A relay carries the game's packets only; it can't read anything but who is
 * talking to whom. To use your own relay, set NEXT_PUBLIC_TURN_URL, NEXT_PUBLIC_TURN_USER and
 * NEXT_PUBLIC_TURN_PASS.
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

/** The options for `new Peer(id, PEER_OPTIONS)` / `new Peer(PEER_OPTIONS)`. */
export const PEER_OPTIONS = { config: { iceServers: ICE_SERVERS, sdpSemantics: "unified-plan" } };
