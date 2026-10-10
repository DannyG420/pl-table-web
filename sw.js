// Service worker: app shell cache-first; ESPN/FotMob data network-first with cached fallback; images stale-while-revalidate.
const SHELL = 'plt-shell-v2', DATA = 'plt-data-v1', IMG = 'plt-img-v1';
const ASSETS = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.json', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/trophy.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => ![SHELL, DATA, IMG].includes(k)).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (u.origin === location.origin) {
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(SHELL).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
  } else if (/\.(png|jpe?g|webp)$/i.test(u.pathname) || u.pathname.startsWith('/combiner') || u.hostname.startsWith('images.')) {
    e.respondWith(caches.open(IMG).then(async c => { const hit = await c.match(e.request); const net = fetch(e.request).then(r => { if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()); return r; }).catch(() => hit); return hit || net; }));
  } else if (/espn\.com|fotmob\.com/.test(u.hostname)) {
    e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(DATA).then(x => x.put(e.request, c)); } return r; }).catch(() => caches.match(e.request)));
  }
});
