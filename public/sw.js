// HIVEMIND service worker: shows push notifications (reminders, daily brief, incoming calls)
// even when the app is closed, and opens the right page when one is tapped. In production
// (registered as /sw.js?cache=1) it also keeps the app pages and build files so HIVEMIND opens
// with no network; notes and memories themselves live in IndexedDB (lib/offline.ts).

const CACHE_ON = new URL(self.location.href).searchParams.get("cache") === "1";
const PAGES = "hivemind-pages";
const STATIC = "hivemind-static";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) =>
  e.waitUntil(
    (async () => {
      // Dev server: never serve stale build files.
      if (!CACHE_ON) await Promise.all([caches.delete(PAGES), caches.delete(STATIC)]);
      await self.clients.claim();
    })(),
  ),
);

self.addEventListener("fetch", (e) => {
  const req = e.request;
  // Android's Share menu → HIVEMIND (manifest share_target): keep what was shared, then open /share,
  // which saves it with the owner's session.
  if (req.method === "POST" && new URL(req.url).pathname === "/share-in") return e.respondWith(takeShare(req));
  if (!CACHE_ON) return;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const p = url.pathname;
  // Build files have hashed names: once fetched they never change.
  if (p.startsWith("/_next/static/") || p.startsWith("/icons/")) return e.respondWith(cacheFirst(req));
  if (req.mode === "navigate" && !p.startsWith("/api/") && !p.startsWith("/unlock") && !p.startsWith("/call/")) e.respondWith(page(req));
});

const SHARE = "hivemind-share";

async function takeShare(req) {
  try {
    const form = await req.formData();
    const box = await caches.open(SHARE);
    for (const k of await box.keys()) await box.delete(k);
    const files = [];
    let i = 0;
    for (const f of form.getAll("files")) {
      if (!(f instanceof File) || !f.size || i >= 5) continue;
      const key = `/share-inbox/file-${i++}`;
      await box.put(key, new Response(f, { headers: { "Content-Type": f.type || "application/octet-stream" } }));
      files.push({ key, name: f.name, type: f.type, size: f.size });
    }
    const meta = { title: form.get("title") || "", text: form.get("text") || "", url: form.get("url") || "", files, at: Date.now() };
    await box.put("/share-inbox/meta", new Response(JSON.stringify(meta), { headers: { "Content-Type": "application/json" } }));
  } catch {
    return Response.redirect("/share?error=1", 303);
  }
  return Response.redirect("/share", 303);
}

async function cacheFirst(req) {
  const c = await caches.open(STATIC);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) await putStatic(c, req, res.clone());
  return res;
}

async function putStatic(c, req, res) {
  await c.put(req, res);
  // Old builds' files pile up; keep the newest few hundred.
  const keys = await c.keys();
  if (keys.length > 500) await Promise.all(keys.slice(0, 100).map((k) => c.delete(k)));
}

// Pages: always the network when there is one; the last good copy when there isn't.
async function page(req) {
  const key = new URL(req.url).pathname;
  try {
    const res = await fetch(req);
    // A redirect (locked → /unlock) is never kept.
    if (res.ok && res.type === "basic" && !res.redirected) await (await caches.open(PAGES)).put(key, res.clone());
    return res;
  } catch {
    const hit = await (await caches.open(PAGES)).match(key);
    return hit || new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
}

// The app asks for its main pages (and the build files they load) to be kept, while online.
self.addEventListener("message", (e) => {
  if (CACHE_ON && e.data?.type === "warm" && Array.isArray(e.data.urls)) e.waitUntil(warm(e.data.urls));
});

async function warm(urls) {
  const pages = await caches.open(PAGES);
  const stat = await caches.open(STATIC);
  for (const u of urls) {
    try {
      const res = await fetch(u, { credentials: "same-origin" });
      if (!res.ok || res.redirected) continue;
      const html = await res.clone().text();
      await pages.put(u, res);
      const assets = [...new Set(html.match(/\/_next\/static\/[^"'\s\\)]+/g) || [])];
      await Promise.all(
        assets.map(async (a) => {
          if (await stat.match(a)) return;
          const r = await fetch(a).catch(() => null);
          if (r?.ok) await putStatic(stat, a, r);
        }),
      );
    } catch {}
  }
}

const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>HIVEMIND · offline</title><style>
:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d1117;color:#e6edf3;font:15px/1.5 system-ui,sans-serif;padding:16px}
main{max-width:360px;text-align:center}h1{font:600 13px ui-monospace,monospace;letter-spacing:.3em;margin:0 0 16px}
p{color:#8b949e;margin:0 0 20px}a,button{display:inline-block;margin:4px;padding:8px 14px;border:1px solid #30363d;border-radius:6px;color:#e6edf3;background:#161b22;text-decoration:none;font:inherit;cursor:pointer}
</style></head><body><main><h1>HIVEMIND</h1><p>You're offline and this page isn't saved on this device yet. Your notes and memories still work.</p>
<a href="/notes">Notes</a><a href="/memories">Memories</a><button onclick="location.reload()">Try again</button></main></body></html>`;

self.addEventListener("push", (e) => {
  let n = {};
  try {
    n = e.data ? e.data.json() : {};
  } catch {
    n = { title: "HIVEMIND", body: e.data ? e.data.text() : "" };
  }
  e.waitUntil(
    self.registration.showNotification(n.title || "HIVEMIND", {
      body: n.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: n.tag,
      renotify: !!n.tag,
      requireInteraction: !!n.sticky,
      vibrate: n.sticky ? [400, 200, 400, 200, 400] : [120, 60, 120],
      actions: n.actions || [],
      data: { url: n.url || "/", ...(n.data || {}) },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  if (e.action === "dismiss" || e.action === "decline") return;
  // Web task Approve / Reject straight from the notification.
  const webTask = e.notification.data?.webTask;
  if (webTask && (e.action === "web-approve" || e.action === "web-reject")) {
    const approve = e.action === "web-approve";
    e.waitUntil(
      fetch(`/api/web-tasks/${webTask}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: approve ? "approve" : "reject" }),
      })
        .then((r) => (r.ok ? self.registration.showNotification(approve ? "▶️ Approved, continuing" : "✋ Rejected", { body: "Open HIVEMIND to watch.", icon: "/icons/icon-192.png", tag: `web-${webTask}`, data: { url: `/web?task=${webTask}` } }) : Promise.reject(r.status)))
        .catch(() => self.clients.openWindow(`/web?task=${webTask}`)),
    );
    return;
  }
  // Habit buttons work without opening the app.
  const habit = e.notification.data?.habit;
  if (habit && (e.action === "habit-done" || e.action === "habit-snooze")) {
    const done = e.action === "habit-done";
    e.waitUntil(
      fetch(`/api/habits/${habit}/${done ? "check" : "snooze"}`, { method: "POST", credentials: "same-origin" })
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((j) =>
          done
            ? self.registration.showNotification(`${j.emoji || "✅"} ${j.name} done`, {
                body: j.streak ? `🔥 ${j.streak}-day streak${j.streak >= j.best && j.streak > 1 ? " · your best!" : ""}` : "Logged for today.",
                icon: "/icons/icon-192.png",
                tag: `habit-${habit}`,
              })
            : null,
        )
        .catch(() => self.clients.openWindow("/habits")),
    );
    return;
  }
  const url = new URL(e.notification.data?.url || "/", self.location.origin).href;
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Reuse an open HIVEMIND window if there is one.
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin) {
          await w.focus();
          return w.navigate(url);
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
