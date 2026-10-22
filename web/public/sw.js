// Phone notifications: show what the server pushes (a comment, a report of
// your game, an opponent who joined), and open the app where it points.
// No caching here: the app always loads fresh.

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
