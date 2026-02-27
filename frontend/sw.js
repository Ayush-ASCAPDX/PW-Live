const CACHE_NAME = "ascapdx-v1";
const ASSETS = [
  "./index.html",
  "./chat.html",
  "./posts.html",
  "./profile.html",
  "./settings.html",
  "./insights.html",
  "./css/home.css",
  "./css/navbar-chat-theme.css",
  "./js/app-config.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch(() => {})
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((hit) => hit || fetch(event.request).catch(() => caches.match("./index.html")))
  );
});
