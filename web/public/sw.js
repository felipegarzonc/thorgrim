// The app on the phone: its files (versioned by name, so they never change)
// are kept here once loaded, and the page itself is asked from the network
// but opens from the kept copy when the network is slow or gone: the app
// opens at once, and at the table without signal. The API is never cached.
//
// And phone notifications: show what the server pushes (a comment, a report
// of your game, an opponent who joined), and open the app where it points.

const FILES = "thorgrim-files-v1";
const PAGE = "thorgrim-page-v1";
const KEEP_FILES = 150;
/** How long the page waits for the network before opening the kept copy. */
const PAGE_WAIT_MS = 800;

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
    // The page: fresh when the signal answers quickly; otherwise the kept one opens at once (and offline),
    // and the fresh one is kept for next time. A newer version still shows up: the app offers to reload.
    const fresh = fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        void caches.open(PAGE).then((c) => c.put("/", copy));
      }
      return res;
    });
    event.waitUntil(fresh.then(() => undefined, () => undefined));
    event.respondWith(
      caches.match("/", { cacheName: PAGE }).then((kept) => {
        if (!kept) return fresh.catch(() => Response.error());
        const slow = new Promise((resolve) => setTimeout(() => resolve(kept), PAGE_WAIT_MS));
        return Promise.race([fresh.then((res) => (res.ok ? res : kept), () => kept), slow]);
      }),
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
