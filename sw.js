const CODE_CACHE = 'all-seeing-eye-code-v8';
const MEDIA_CACHE = 'all-seeing-eye-media-v1';

const CODE_ASSETS = [
  './',
  './index.html',
  './main.js',
  './manifest.webmanifest',
  './vendor/three.module.js',
  './vendor/mindar-image-three.prod.js',
  './vendor/controller-mGt1s8dJ.js',
  './vendor/ui-fBadYuor.js',
  './vendor/three-addons/CSS3DRenderer.js'
];

const MEDIA_ASSETS = [
  './assets/allseeingeye.png',
  './assets/background.png',
  './assets/startbutton.png',
  './assets/t7clogo.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/targets.mind',
  './assets/anim01.mp4',
  './assets/anim02.mp4',
  './assets/anim03.mp4',
  './assets/anim04.mp4'
];

// Install Event: Smart Two-Tier Caching (Reuses 35MB media cache across code updates)
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      console.log('[SW] Installing update with Smart Two-Tier Cache...');

      // 1. Cache Code Assets (~15 KB)
      const codeCache = await caches.open(CODE_CACHE);
      for (const url of CODE_ASSETS) {
        try {
          await codeCache.add(url);
        } catch (e) {
          console.warn('[SW] Code cache warning:', url, e);
        }
      }

      // 2. Cache Media Assets (~35 MB) - Skip if already cached in MEDIA_CACHE!
      const mediaCache = await caches.open(MEDIA_CACHE);
      let mediaTotal = MEDIA_ASSETS.length;
      let mediaCachedCount = 0;

      for (const url of MEDIA_ASSETS) {
        try {
          const existing = await mediaCache.match(url, { ignoreSearch: true });
          if (existing && existing.ok) {
            // Already in local media cache -> REUSE IT, NO RE-DOWNLOAD!
            console.log('[SW] Reusing cached media asset (0 bytes downloaded):', url);
          } else {
            console.log('[SW] Downloading new media asset:', url);
            await mediaCache.add(url);
          }
        } catch (e) {
          console.warn('[SW] Media cache warning:', url, e);
        }
        mediaCachedCount++;
        const pct = Math.round((mediaCachedCount / mediaTotal) * 100);

        // Broadcast progress
        const clientsList = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
        clientsList.forEach((client) => {
          client.postMessage({ type: 'CACHE_PROGRESS', progress: pct });
        });
      }

      // Store completion flag
      try {
        await mediaCache.put(
          new Request('./offline-ready-flag'),
          new Response('ready', { status: 200, statusText: 'OK' })
        );
      } catch (e) {}

      console.log('[SW] Smart Two-Tier precaching complete.');
      const clientsList = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
      clientsList.forEach((client) => {
        client.postMessage({ type: 'CACHE_COMPLETE' });
      });
    })().then(() => self.skipWaiting())
  );
});

// Activate Event: Clean up old code caches, but KEEP MEDIA_CACHE intact!
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          // Keep active CODE_CACHE and permanent MEDIA_CACHE, delete legacy single-tier caches
          if (key !== CODE_CACHE && key !== MEDIA_CACHE) {
            console.log('[SW] Deleting legacy/old code cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Interception
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1. Range Request Handler for iOS Safari Video Streaming
  if (req.headers.has('range') || url.pathname.endsWith('.mp4')) {
    event.respondWith(handleRangeRequest(req));
    return;
  }

  // 2. Cache-First Strategy across both CODE_CACHE and MEDIA_CACHE
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cachedResponse) => {
      if (cachedResponse) {
        fetch(req).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const cacheName = url.pathname.includes('/assets/') ? MEDIA_CACHE : CODE_CACHE;
            caches.open(cacheName).then((cache) => cache.put(req, networkResponse));
          }
        }).catch(() => {/* Offline fallback */});
        return cachedResponse;
      }
      return fetch(req).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        const cacheName = url.pathname.includes('/assets/') ? MEDIA_CACHE : CODE_CACHE;
        caches.open(cacheName).then((cache) => cache.put(req, responseToCache));
        return networkResponse;
      });
    })
  );
});

// Specialized Range Request Handler for iOS Safari Video compatibility
async function handleRangeRequest(request) {
  const mediaCache = await caches.open(MEDIA_CACHE);
  let response = await mediaCache.match(request, { ignoreSearch: true });

  if (!response) {
    // Check fallback in legacy/code caches
    response = await caches.match(request, { ignoreSearch: true });
  }

  if (!response) {
    try {
      response = await fetch(request);
    } catch (err) {
      console.error('[SW] Range request fetch failed:', err);
      return new Response('', { status: 404, statusText: 'Not Found' });
    }
  }

  if (response.status === 206) {
    return response;
  }

  const rangeHeader = request.headers.get('range');
  if (!rangeHeader) {
    return response;
  }

  const arrayBuffer = await response.arrayBuffer();
  const total = arrayBuffer.byteLength;
  const parts = rangeHeader.replace(/bytes=/, '').split('-');

  let start = parseInt(parts[0], 10);
  let end = parts[1] ? parseInt(parts[1], 10) : total - 1;

  if (isNaN(start)) {
    start = total - end;
    end = total - 1;
  }
  if (isNaN(end)) {
    end = total - 1;
  }

  start = Math.max(0, start);
  end = Math.min(total - 1, end);

  if (start >= total || end >= total) {
    return new Response('', {
      status: 416,
      statusText: 'Range Not Satisfiable',
      headers: { 'Content-Range': `bytes */${total}` }
    });
  }

  const slicedBuffer = arrayBuffer.slice(start, end + 1);

  return new Response(slicedBuffer, {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': slicedBuffer.byteLength,
      'Content-Type': response.headers.get('Content-Type') || 'video/mp4'
    }
  });
}
