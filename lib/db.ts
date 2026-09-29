import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Supabase occasionally rejects a request with "JWT issued at future" (clock skew between its
 * gateway and database) or a brief 5xx/network blip. Both clear within a second, so retry twice.
 */
async function resilientFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(input, init);
      if (attempt < 2 && (res.status === 401 || res.status >= 500)) {
        const body = await res.clone().text();
        if (res.status >= 500 || /issued at future|JWT/i.test(body)) {
          await sleep(350 * (attempt + 1));
          continue;
        }
      }
      return res;
    } catch (err) {
      if (attempt >= 2) throw err;
      await sleep(350 * (attempt + 1));
    }
  }
}

/** Server-only client with the secret key. The browser never talks to Supabase directly. */
export function db() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SECRET_KEY are not set");
  client ??= createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: resilientFetch },
  });
  return client;
}
