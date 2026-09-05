/**
 * Service worker: държи обвивката на приложението в кеша, за да работи
 * таблицата, изчисленията и правната проверка без връзка (част A.1, D.7.2).
 * Заявките към ИИ-асистента винаги минават по мрежата и никога не се кешират.
 */
const CACHE = "grafik-bdz-v1";
const SHELL = ["/", "/reisove", "/nastroyki", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // ИИ-асистентът изисква мрежа — не се кешира.
  if (url.pathname.startsWith("/api/")) return;

  // Навигации: първо мрежата (за свежа версия), при липса на връзка — кешът.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => undefined);
          return res;
        })
        .catch(async () => (await caches.match(req)) ?? (await caches.match("/")) ?? Response.error()),
    );
    return;
  }

  // Статични ресурси: първо кешът.
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ??
        fetch(req).then((res) => {
          if (res.ok && (url.pathname.startsWith("/_next/") || url.pathname.startsWith("/icon"))) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => undefined);
          }
          return res;
        }),
    ),
  );
});
