/* Service worker — versioned caches, privacy-first.
 *  - Static build assets, icons and menu images: cache-first.
 *  - Public menu/config API: network-first with cached fallback (no personal data).
 *  - Every other API, staff/admin pages and all non-GET requests: network only, never cached.
 *  - Navigations: network-first; offline -> /offline page. Orders are never queued offline.
 */
const VERSION = "v1";
const STATIC_CACHE = `static-${VERSION}`;
const MENU_CACHE = `menu-${VERSION}`;
const OFFLINE_URL = "/offline";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/images/menu/placeholder.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => ![STATIC_CACHE, MENU_CACHE].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isStaticAsset(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/images/") || url.pathname.startsWith("/icons/");
}

function isPublicMenuApi(url) {
  return url.pathname === "/api/v1/public/menu" || url.pathname === "/api/v1/public/config";
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // never intercept order submission or any write
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/staff") || url.pathname.startsWith("/admin")) return; // shared devices: no caching
  if (req.headers.get("accept")?.includes("text/event-stream")) return;

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) caches.open(STATIC_CACHE).then((c) => c.put(req, res.clone()));
            return res;
          }),
      ),
    );
    return;
  }

  if (isPublicMenuApi(url)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(MENU_CACHE).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || Response.error())),
    );
    return;
  }

  if (url.pathname.startsWith("/api/")) return; // personal/operational data: network only

  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
  }
});
