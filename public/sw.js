/*
 * spli7 service worker.
 *
 * A lightweight, dependency-free service worker that caches static assets to
 * save bandwidth and improve load performance, while always serving fresh data
 * for dynamic/API requests.
 *
 * Caching strategy:
 *  - Immutable, content-hashed assets (/_next/static): cache-first — fetched
 *    from the network once, then served from cache.
 *  - Other static files (/logo, icons, fonts in /public): their URLs carry no
 *    hash, so stale-while-revalidate picks up a changed file on the next load.
 *  - Optimized images (/_next/image): stale-while-revalidate.
 *  - Page navigations: network-first with a cached fallback, then the offline
 *    page when both network and cache miss. A redirected page is stored under
 *    its final URL (a navigation cannot use a redirected response), and
 *    /groups/<id> falls back to /groups/<id>/expenses.
 *  - Offline add: the group layout posts WARM_GROUP while online, and the
 *    worker caches that group's expense list and create form plus the
 *    /_next/static files their HTML references, so both open offline later.
 *  - API / tRPC requests and any non-GET request: never cached (always network),
 *    so expense data is never stale.
 *
 * Runtime and image caches are trimmed to a maximum number of entries (oldest
 * first), so old hashed chunks from earlier deploys do not pile up forever.
 *
 * Bump CACHE_VERSION to invalidate all previously cached content on deploy.
 */

const CACHE_VERSION = 'v4'
const PRECACHE = `spli7-precache-${CACHE_VERSION}`
const RUNTIME = `spli7-runtime-${CACHE_VERSION}`
const IMAGE_CACHE = `spli7-images-${CACHE_VERSION}`

const OFFLINE_URL = '/offline.html'

const MAX_ENTRIES = {
  [`spli7-runtime-${CACHE_VERSION}`]: 300,
  [`spli7-images-${CACHE_VERSION}`]: 60,
}

/** Deletes the oldest entries (Cache keys keep insertion order). */
async function trimCache(cacheName) {
  const max = MAX_ENTRIES[cacheName]
  if (!max) return
  const cache = await caches.open(cacheName)
  const keys = await cache.keys()
  const excess = keys.length - max
  if (excess <= 0) return
  await Promise.all(keys.slice(0, excess).map((key) => cache.delete(key)))
}

async function putAndTrim(cache, cacheName, request, response) {
  await cache.put(request, response)
  await trimCache(cacheName)
}

const PRECACHE_URLS = [
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/logo/128x128.png',
  '/logo/192x192.png',
  '/logo/512x512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PRECACHE)
      await Promise.allSettled(
        PRECACHE_URLS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })),
        ),
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
  if (response && response.ok)
    putAndTrim(cache, cacheName, request, response.clone()).catch(() => {})
  return response
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok)
        putAndTrim(cache, cacheName, request, response.clone()).catch(() => {})
      return response
    })
    .catch(() => undefined)
  return cached || (await network) || Response.error()
}

/**
 * A copy of `response` without the `redirected` flag: a navigation refuses a
 * redirected response, so cached pages are stored clean under their final URL.
 */
async function cleanResponse(response) {
  const body = await response.blob()
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

async function cachePage(cache, cacheName, request, response) {
  const key = response.redirected ? new Request(response.url) : request
  await putAndTrim(cache, cacheName, key, await cleanResponse(response))
}

const GROUP_ROOT = /^\/groups\/([^/]+)\/?$/

async function cachedPage(cache, request) {
  const url = new URL(request.url)
  const exact = await cache.match(request)
  if (exact) return exact
  // e.g. /expenses/create?fromExpense=… → the cached plain create form.
  const withoutSearch = await cache.match(request, { ignoreSearch: true })
  if (withoutSearch) return withoutSearch
  const root = url.pathname.match(GROUP_ROOT)
  if (root) return cache.match(`/groups/${root[1]}/expenses`)
  return undefined
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  try {
    const response = await fetch(request)
    if (response && response.ok)
      cachePage(cache, cacheName, request, response.clone()).catch(() => {})
    return response
  } catch (err) {
    const cached = await cachedPage(cache, request)
    if (cached) return cached
    const offline = await caches.match(OFFLINE_URL)
    if (offline) return offline
    throw err
  }
}

const STATIC_REF = /\/_next\/static\/[A-Za-z0-9_\-.~%@/]+?\.(?:js|css|woff2?)/g
const WARM_INTERVAL = 10 * 60 * 1000
const lastWarm = new Map()

/** Caches a page and the hashed static files its HTML references. */
async function warmPage(path) {
  const cache = await caches.open(RUNTIME)
  const response = await fetch(path, { credentials: 'same-origin' })
  const type = response.headers.get('content-type') || ''
  if (!response.ok || !type.includes('text/html')) return
  const html = await response.clone().text()
  await cachePage(cache, RUNTIME, new Request(path), response)
  const refs = [...new Set(html.match(STATIC_REF) || [])]
  for (const ref of refs) {
    if (await caches.match(ref)) continue
    try {
      const asset = await fetch(ref)
      if (asset.ok) await cache.put(ref, asset)
    } catch {
      // Best effort: a missing chunk only matters offline.
    }
  }
  await trimCache(RUNTIME)
}

async function warmGroup(groupId) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(groupId)) return
  const now = Date.now()
  if (now - (lastWarm.get(groupId) || 0) < WARM_INTERVAL) return
  lastWarm.set(groupId, now)
  for (const path of [
    `/groups/${groupId}/expenses`,
    `/groups/${groupId}/expenses/create`,
  ]) {
    try {
      await warmPage(path)
    } catch {
      lastWarm.delete(groupId)
    }
  }
}

function isHashedAsset(url) {
  return url.pathname.startsWith('/_next/static/')
}

function isStaticAsset(url) {
  return (
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

  if (isHashedAsset(url)) {
    event.respondWith(cacheFirst(request, RUNTIME))
    return
  }

  if (isStaticAsset(url)) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME))
    return
  }
})

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
  const data = event.data
  if (data && data.type === 'WARM_GROUP' && typeof data.groupId === 'string')
    event.waitUntil(warmGroup(data.groupId))
})
