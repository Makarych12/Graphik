/**
 * Service worker: държи обвивката на приложението в кеша, за да работи
 * таблицата, изчисленията, правната проверка и печатът без връзка (част A.1,
 * D.7.2). Заявките към ИИ-асистента винаги минават по мрежата и не се кешират.
 *
 * Скриптовете и стиловете на Next носят хеш в името си и се знаят чак след
 * сглобяването, затова не могат да се изброят тук. При инсталиране обвивката
 * се сваля, от разметката ѝ се изваждат адресите на ресурсите от /_next/ и те
 * се слагат в кеша. Без това в кеша влизаха само HTML документите: страницата
 * се отваряше офлайн, но оставаше на „Зареждане…“, защото приложението няма
 * откъде да зареди кода си.
 */
/**
 * Версията идва от адреса на скрипта (/sw.js?v=<сборка>). Всеки деплой дава
 * ново име на кеша; при активиране всички стари кешове се изтриват, така че
 * след деплой е невъзможно да се сервира стар код от кеша.
 */
const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const CACHE = `grafik-bdz-${VERSION}`;

/** Разделите, които трябва да се отварят и без връзка. */
const ROUTES = ["/", "/reisove", "/nastroyki"];
const EXTRA = ["/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

async function precache() {
  const cache = await caches.open(CACHE);
  const assets = new Set(EXTRA);

  for (const route of ROUTES) {
    try {
      const res = await fetch(route, { cache: "reload" });
      if (!res.ok) continue;
      await cache.put(route, res.clone());
      const html = await res.text();
      // src="/_next/…" и href="/_next/…" — скриптове, стилове, предзареждания.
      for (const m of html.matchAll(/(?:src|href)="(\/_next\/[^"]+)"/g)) assets.add(m[1]);
    } catch {
      /* при липса на връзка по време на инсталиране просто няма какво да се свали */
    }
  }

  // Един неуспешен ресурс не бива да проваля целия кеш.
  await Promise.all(
    [...assets].map((u) => cache.add(u).catch(() => undefined)),
  );
}

self.addEventListener("install", (e) => {
  e.waitUntil(precache().catch(() => undefined));
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
        .catch(async () =>
          (await caches.match(req)) ??
          (await caches.match(url.pathname)) ??
          (await caches.match("/")) ??
          Response.error(),
        ),
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
