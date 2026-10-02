import "server-only";

/**
 * Steel.dev cloud browsers (REST: https://api.steel.dev, header "steel-api-key"). Each web task gets
 * one session; HIVEMIND attaches to it over CDP, so the browser keeps running between the short
 * Vercel function calls that drive it. debugUrl is a live view the owner can watch and take over
 * (it is unauthenticated by design: only ever shown inside the locked app).
 */
const API = "https://api.steel.dev/v1";
// Steel's entry plan caps a session at 15 minutes.
export const SESSION_MS = 15 * 60_000;

export type SteelSession = { id: string; websocketUrl: string; debugUrl: string; sessionViewerUrl: string; status: "live" | "released" | "failed"; profileId?: string };

export const steelConfigured = () => !!process.env.STEEL_API_KEY;

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "steel-api-key": process.env.STEEL_API_KEY ?? "", "Content-Type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Steel ${res.status}: ${data.message ?? data.error ?? "request failed"}`);
  return data as T;
}

/** A new cloud browser. With a profile id, it starts logged in wherever the owner logged in before. */
export async function createSession(opts: { profileId?: string | null } = {}) {
  const base = { timeout: SESSION_MS, blockAds: true, dimensions: { width: 1280, height: 800 } };
  try {
    return await call<SteelSession>("/sessions", {
      method: "POST",
      body: JSON.stringify({ ...base, persistProfile: true, ...(opts.profileId ? { profileId: opts.profileId } : {}) }),
    });
  } catch (err) {
    // Profiles may not be on every plan: a plain session still works, just without saved logins.
    console.warn("steel: session with profile failed, trying without:", err instanceof Error ? err.message : err);
    return call<SteelSession>("/sessions", { method: "POST", body: JSON.stringify(base) });
  }
}

export const getSession = (id: string) => call<SteelSession>(`/sessions/${id}`);

export async function releaseSession(id: string) {
  await call(`/sessions/${id}/release`, { method: "POST", body: "{}" }).catch(() => {});
}

export const cdpUrl = (sessionId: string) => `wss://connect.steel.dev?apiKey=${encodeURIComponent(process.env.STEEL_API_KEY ?? "")}&sessionId=${sessionId}`;
