// Service Worker for Sayyida Khadeeja Apparel PWA
const CACHE_NAME = 'sk-apparel-v1';

// App shell — files we control
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/icons/apple-touch-icon.png'
];

// CDN assets — third-party libraries (versioned, safe to cache long-term)
const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js',
  'https://cdn.tailwindcss.com/3.4.17',
  'https://cdn.jsdelivr.net/npm/lucide@0.263.0/dist/umd/lucide.min.js',
  'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
  'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap'
];

// Install — pre-cache app shell + CDN assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Caching app shell + CDN assets');
      // Cache app shell first (must succeed)
      return cache.addAll(APP_SHELL).then(() => {
        // Cache CDN assets individually (don't fail install if one CDN is slow)
        return Promise.allSettled(
          CDN_ASSETS.map(url =>
            cache.add(url).catch(err => console.warn('[SW] CDN cache skip:', url, err))
          )
        );
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate — clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => {
          console.log('[SW] Removing old cache:', k);
          return caches.delete(k);
        })
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch strategy:
// - API calls (Supabase) → Network only (never cache dynamic data)
// - App shell & CDN → Stale-while-revalidate (fast from cache, update in background)
// - Everything else → Network first, fallback to cache
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip Supabase API calls — always fresh data
  if (url.hostname.includes('supabase')) return;

  // Skip chrome-extension and other non-http
  if (!url.protocol.startsWith('http')) return;

  // CDN assets and app shell — stale-while-revalidate
  const isCDN = CDN_ASSETS.some(cdn => event.request.url.startsWith(cdn));
  const isAppShell = APP_SHELL.some(path => url.pathname === path || url.pathname + 'index.html' === path);

  if (isCDN || isAppShell) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(event.request).then(cached => {
          const fetchPromise = fetch(event.request).then(response => {
            if (response && response.ok) {
              cache.put(event.request, response.clone());
            }
            return response;
          }).catch(() => cached);

          return cached || fetchPromise;
        })
      )
    );
    return;
  }

  // Google Fonts (woff2 files) — cache first
  if (url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(response => {
            if (response.ok) cache.put(event.request, response.clone());
            return response;
          });
        })
      )
    );
    return;
  }

  // Everything else — network first, fallback to cache
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
