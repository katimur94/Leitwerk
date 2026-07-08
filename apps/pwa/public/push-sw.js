// Web-Push-Handler (Etappe 2) — wird via workbox.importScripts in den
// generierten Service Worker geladen. Payload kommt von der Edge Function
// send-push: {title, body, url, kind}.
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Leitwerk", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || "Leitwerk", {
      body: payload.body || "",
      icon: "/logo.svg",
      badge: "/logo.svg",
      data: { url: payload.url || "/" },
      tag: payload.kind || "leitwerk",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
