const CACHE_NAME = 'all-seeing-eye-v5';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './main.js',
  './manifest.webmanifest',
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
  './assets/anim04.mp4',
  './vendor/three.module.js',
  './vendor/mindar-image-three.prod.js',
  './vendor/controller-mGt1s8dJ.js',
  './vendor/ui-fBadYuor.js',
  './vendor/three-addons/CSS3DRenderer.js'
];

// Install Event: Cache all essential assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log('[SW] Pre-caching offline assets...');
      let total = ASSETS_TO_CACHE.length;
      let cachedCount = 0;
      let hasFailed = false;

      for (const url of ASSETS_TO_CACHE) {
        try {
          await cache.add(url);
          cachedCount++;
          const progressPct = Math.round((cachedCount / total) * 100);
          
          // Broadcast caching progress to all window clients
          const clientsList = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
          clientsList.forEach((client) => {
            client.postMessage({
              type: 'CACHE_PROGRESS',
              progress: progressPct,
              cachedCount,
              total
            });
          });
        } catch (err) {
          console.warn('[SW] Failed to cache:', url, err);
          hasFailed = true;
        }
      }

      if (!hasFailed) {
        console.log('[SW] All essential assets successfully cached for offline use.');
        const clientsList = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
        clientsList.forEach((client) => {
          client.postMessage({ type: 'CACHE_COMPLETE' });
        });
      }
    }).then(() => self.skipWaiting())
  );
});

// Activate Event: Clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', key);
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

  // 2. Standard Cache-First Strategy for static assets
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cachedResponse) => {
      if (cachedResponse) {
        fetch(req).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(req, networkResponse));
          }
        }).catch(() => {/* Offline fallback */});
        return cachedResponse;
      }
      return fetch(req).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, responseToCache));
        return networkResponse;
      });
    })
  );
});

// Specialized Range Request Handler for iOS Safari Video compatibility
async function handleRangeRequest(request) {
  const cache = await caches.open(CACHE_NAME);
  let response = await cache.match(request, { ignoreSearch: true });

  if (!response) {
    try {
      response = await fetch(request);
    } catch (err) {
      console.error('[SW] Range request fetch failed:', err);
      return new Response('', { status: 404, statusText: 'Not Found' });
    }
  }

  // If response is already a partial 206 response, return directly
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
