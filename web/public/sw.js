// The app on the phone: its files (versioned by name, so they never change)
// are kept here once loaded, and the page itself is asked from the network
// first, falling back to the kept copy offline: the app opens at once, and
// at the table without signal. The API is never cached.
//
// And phone notifications: show what the server pushes (a comment, a report
// of your game, an opponent who joined), and open the app where it points.

const FILES = "thorgrim-files-v1";
const PAGE = "thorgrim-page-v1";
const KEEP_FILES = 150;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== FILES && n !== PAGE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

/** Older app versions' files go once there are many. */
async function trim() {
  const cache = await caches.open(FILES);
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_FILES))) await cache.delete(k);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const appFile = url.origin === self.location.origin && url.pathname.startsWith("/assets/");
  const font = url.hostname === "fonts.gstatic.com";
  if (appFile || font) {
    // Kept forever: a new version has new names.
    event.respondWith(
      caches.open(FILES).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok || res.type === "opaque") {
          await cache.put(req, res.clone());
          void trim();
        }
        return res;
      }),
    );
    return;
  }
  if (req.mode === "navigate" && url.origin === self.location.origin && !url.pathname.startsWith("/api") && !/^\/(es\/)?(r|join|play)\//.test(url.pathname)) {
    // The page: fresh when there is signal, the kept one when there isn't.
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            void caches.open(PAGE).then((c) => c.put("/", copy));
          }
          return res;
        })
        .catch(async () => (await caches.match("/", { cacheName: PAGE })) ?? Response.error()),
    );
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Thorgrim", {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag,
      data: { href: data.href || "#/club" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = (event.notification.data && event.notification.data.href) || "#/club";
  const url = new URL("/" + href.replace(/^\//, ""), self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.startsWith(self.location.origin)) {
          w.navigate(url);
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
