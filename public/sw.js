/*
 * Spl1t service worker.
 *
 * A lightweight, dependency-free service worker that caches static assets to
 * save bandwidth and improve load performance, while always serving fresh data
 * for dynamic/API requests.
 *
 * Caching strategy:
 *  - Immutable, content-hashed assets (/_next/static, /logo, icons, fonts):
 *    cache-first — fetched from the network once, then served from cache.
 *  - Optimized images (/_next/image): stale-while-revalidate.
 *  - Page navigations: network-first with a cached fallback, then the offline
 *    page when both network and cache miss.
 *  - API / tRPC requests and any non-GET request: never cached (always network),
 *    so expense data is never stale.
 *
 * Bump CACHE_VERSION to invalidate all previously cached content on deploy.
 */

const CACHE_VERSION = 'v1'
const PRECACHE = `spl1t-precache-${CACHE_VERSION}`
const RUNTIME = `spl1t-runtime-${CACHE_VERSION}`
const IMAGE_CACHE = `spl1t-images-${CACHE_VERSION}`

const OFFLINE_URL = '/offline.html'

const PRECACHE_URLS = [
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/logo-with-text.png',
  '/logo/192x192.png',
  '/logo/512x512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PRECACHE)
      await Promise.allSettled(
        PRECACHE_URLS.map((url) => cache.add(new Request(url, { cache: 'reload' }))),
      )
      // Intentionally do NOT call skipWaiting() here. A new worker stays waiting
      // until the page posts SKIP_WAITING after the user chooses Reload.
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([PRECACHE, RUNTIME, IMAGE_CACHE])
      const keys = await caches.keys()
      await Promise.all(
        keys.map((key) => (keep.has(key) ? undefined : caches.delete(key))),
      )
      await self.clients.claim()
    })(),
  )
})

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request)
  if (cached) return cached
  const cache = await caches.open(cacheName)
  const response = await fetch(request)
  if (response && response.ok) cache.put(request, response.clone())
  return response
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone())
      return response
    })
    .catch(() => undefined)
  return cached || (await network) || Response.error()
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  try {
    const response = await fetch(request)
    if (response && response.ok) cache.put(request, response.clone())
    return response
  } catch (err) {
    const cached = await cache.match(request)
    if (cached) return cached
    const offline = await caches.match(OFFLINE_URL)
    if (offline) return offline
    throw err
  }
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/logo/') ||
    /\.(?:js|css|woff2?|ttf|otf|eot|png|svg|ico|webp|gif|jpg|jpeg)$/.test(
      url.pathname,
    )
  )
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  if (url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, RUNTIME))
    return
  }

  if (url.pathname.startsWith('/_next/image')) {
    event.respondWith(staleWhileRevalidate(request, IMAGE_CACHE))
    return
  }

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request, RUNTIME))
    return
  }
})

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})
