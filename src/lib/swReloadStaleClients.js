/* Injected after Workbox generateSW. Reloads windows that were left on a
 * stale cached index.html after a deploy (hashed JS 404 → forever Loading…). */
self.addEventListener("install", function () {
  self.__wakaHadActiveWorker = Boolean(self.registration.active);
});

self.addEventListener("activate", function (event) {
  if (!self.__wakaHadActiveWorker) return;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clients) {
      return Promise.all(
        clients.map(function (client) {
          return typeof client.navigate === "function" ? client.navigate(client.url) : Promise.resolve();
        }),
      );
    }),
  );
});
