/* Service worker for the Egypt Field Guide. Build 4b5b51d2d4.
   Shell precached on install. Guide assets and audio are saved by the page (Cache Storage).
   Cached audio answers Range requests with 206 Partial Content (needed by iOS Safari). */
const VERSION = '4b5b51d2d4';
const SHELL = 'shell-v1';
const AUDIO = 'audio-v1';
const SHELL_FILES = ["./", "index.html", "app.css", "app.js", "data.json", "manifest.webmanifest", "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "fonts/Fraunces.woff2", "fonts/Inter.woff2", "fonts/NotoSansEgyptianHieroglyphs.woff2"];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await Promise.all(SHELL_FILES.map(async u => {
      const res = await fetch(new Request(u, { cache: 'reload' }));
      if (!res.ok) throw new Error('precache failed: ' + u);
      await cache.put(u, res);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Explicit network requests from the page (downloads, refresh): let the browser handle them.
  if (url.searchParams.has('fresh') || url.searchParams.has('dl') || url.searchParams.has('net')) return;
  if (url.pathname.endsWith('.mp3')) { event.respondWith(audioResponse(req, url)); return; }
  const isPage = req.mode === 'navigate' && (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html'));
  if (isPage) { event.respondWith(pageResponse(req)); return; }
  event.respondWith(cacheFirst(req, url));
});

async function pageResponse(req) {
  const cache = await caches.open(SHELL);
  const hit = (await cache.match('index.html')) || (await cache.match('./'));
  if (hit) return hit;
  try { return await fetch(req); }
  catch (e) { return new Response('<p>Offline. Open the guide once with a connection.</p>', { status: 503, headers: { 'Content-Type': 'text/html' } }); }
}

async function cacheFirst(req, url) {
  const hit = await caches.match(req, { ignoreSearch: true, ignoreVary: true });
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok && /\/(img|svg|fonts|icons)\//.test(url.pathname)) {
      const copy = res.clone();
      caches.open(SHELL).then(c => c.put(url.origin + url.pathname, copy)).catch(() => {});
    }
    return res;
  } catch (e) {
    if (req.mode === 'navigate') {
      const page = await caches.match('index.html');
      if (page) return page;
    }
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

async function audioResponse(req, url) {
  const cache = await caches.open(AUDIO);
  const hit = await cache.match(url.origin + url.pathname);
  if (!hit) return fetch(req);
  const blob = await hit.blob();
  const size = blob.size;
  const type = hit.headers.get('Content-Type') || 'audio/mpeg';
  const range = req.headers.get('Range');
  if (!range) {
    return new Response(blob, { status: 200, headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' } });
  }
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  let start, end;
  if (!m || (m[1] === '' && m[2] === '')) { start = 0; end = size - 1; }
  else if (m[1] === '') { start = Math.max(0, size - parseInt(m[2], 10)); end = size - 1; }
  else { start = parseInt(m[1], 10); end = m[2] === '' ? size - 1 : Math.min(parseInt(m[2], 10), size - 1); }
  if (start >= size || start > end) {
    return new Response(null, { status: 416, statusText: 'Range Not Satisfiable', headers: { 'Content-Range': `bytes */${size}` } });
  }
  return new Response(blob.slice(start, end + 1, type), {
    status: 206, statusText: 'Partial Content',
    headers: { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes' }
  });
}
