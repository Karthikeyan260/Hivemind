// HIVEMIND service worker: shows push notifications (reminders, daily brief, incoming calls)
// even when the app is closed, and opens the right page when one is tapped.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

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
      data: { url: n.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  if (e.action === "dismiss" || e.action === "decline") return;
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
