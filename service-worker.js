// Walkie-Talkie Translator — service worker
// Bump this on every deploy so the browser fetches new shell files instead
// of serving stale ones from cache. app.js already calls reg.update() on
// every launch and reloads once a new SW takes over, so bumping this is
// the only step needed to ship an update.
const CACHE_VERSION = 'wt-shell-v1';

// Only the app shell is cached. API calls (Gemini, any Secure Proxy URL)
// are deliberately NEVER cached — translations must always be live, and
// caching a response that carries an API key header would be unsafe.
const SHELL_FILES = [
  './',
  './index.html',
  './style.css',
  './data.js',
  './app.js',
  './manifest.json',
  './icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never intercept anything cross-origin (Gemini API, Secure Proxy worker,
  // Google AI Studio links, etc.) — those must always hit the network.
  if(url.origin !== self.location.origin){
    return;
  }
  // Only handle simple GETs; let everything else (there shouldn't be any
  // same-origin POSTs in this app) pass straight through.
  if(event.request.method !== 'GET'){
    return;
  }

  // Cache-first for the app shell, with a network fallback that also
  // refreshes the cache — so the very next launch after a deploy already
  // has the latest shell cached, even before install/activate cycles.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request).then((resp) => {
        if(resp && resp.ok){
          const copy = resp.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, copy));
        }
        return resp;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
