/* Offline fallback for the GitHub Pages build.
   The worker is served at /collatz-hailstone-plotter/sw.js, so its scope
   stays under that path. Online requests go to the network first. */

const CACHE = 'hailstone-v1';
const SCOPE = '/collatz-hailstone-plotter/';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(SCOPE)) return;
  if (url.pathname === `${SCOPE}sw.js`) return;

  event.respondWith(networkFirst(request));
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic' && !response.redirected) {
      const copy = response.clone();
      const key = request.mode === 'navigate' ? SCOPE : request;
      caches
        .open(CACHE)
        .then((cache) => cache.put(key, copy))
        .catch(() => {});
    }
    return response;
  } catch {
    const cached = await caches.match(request.mode === 'navigate' ? SCOPE : request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const shell = await caches.match(`${SCOPE}index.html`);
      if (shell) return shell;
    }
    return new Response('Offline', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
