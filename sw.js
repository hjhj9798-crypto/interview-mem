/* eslint-disable no-restricted-globals */
const CACHE = "interview-mem-v6";
const ASSETS = ["./index.html", "./styles.css", "./app.js", "./icon.svg", "./manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isAppShellUrl(url) {
  return /\/(index\.html|app\.js|styles\.css)(\?|$)/.test(url) || url.endsWith("/interview-mem/") || url.endsWith("/interview-mem");
}

self.addEventListener("fetch", (event) => {
  const url = event.request.url;
  if (url.includes("fonts.googleapis") || url.includes("fonts.gstatic")) {
    event.respondWith(fetch(event.request));
    return;
  }
  if (event.request.method !== "GET") {
    event.respondWith(fetch(event.request));
    return;
  }
  if (isAppShellUrl(url)) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
