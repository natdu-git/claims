// sw.js — Claims service worker (Phase 2: conservative offline shell)
//
// What this file does, in plain language:
//  - On install, it saves a copy of the app's core files (the page itself,
//    the manifest, and the icons) into a local cache, so the app can start
//    even with no internet connection at all.
//  - On activate, it throws away any old cached copies left behind by a
//    previous version of this file, so caches don't pile up over time.
//  - On every request the page makes, it decides whether to answer from
//    that local cache or go fetch a fresh copy from the network — see the
//    fetch handler below for the exact rules.
//
// This version is intentionally conservative: it never forces itself to
// take over the page (no skipWaiting, no clients.claim), so installing a
// new copy of this file only takes effect the next time the app is fully
// closed and reopened. There is no update UI here — that's for a later
// phase. This phase is just about making offline launch work.

// Name of the cache this version of the worker uses. Bump this string
// whenever the list of precached files changes below, so the activate
// step below knows to delete the old one.
const CACHE = "claims-shell-v1";

// The exact set of files needed to start the app with zero network access.
// Every path is relative (no leading "/") so this keeps working no matter
// what folder the app is hosted under.
const SHELL_FILES = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-192-maskable.png",
  "icons/icon-512-maskable.png",
  "icons/apple-touch-icon-180.png"
];

// INSTALL — runs once when the browser first sees this file (or a changed
// copy of it). We download and store the shell files listed above, then
// stop. We deliberately do NOT call skipWaiting() here: the new worker
// will sit and wait until every open tab running the old version has been
// closed, rather than taking over mid-session.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL_FILES))
  );
});

// ACTIVATE — runs once this worker is allowed to become the active one.
// Its only job here is housekeeping: delete any cache left over from an
// older version of this file so storage doesn't grow forever. We
// deliberately do NOT call clients.claim() — this worker will only start
// controlling pages the next time they're freshly loaded, not the tabs
// that are already open right now.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE)
          .map((name) => caches.delete(name))
      )
    )
  );
});

// FETCH — runs for every network request the page makes, and decides how
// to answer it.
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Rule 1: only ever get involved with same-origin GET requests. Anything
  // else — POST requests, and any cross-origin request such as the Google
  // Maps link or the Dropbox API calls the auto-backup feature makes — is
  // left completely alone. We don't call respondWith() at all in that
  // case, so the browser sends the request to the network exactly as if
  // this service worker didn't exist.
  const isSameOrigin = new URL(req.url).origin === self.location.origin;
  if (req.method !== "GET" || !isSameOrigin) {
    return;
  }

  // Rule 2: page loads (navigating to the app) go network-first. We always
  // prefer the freshest copy of the app when the network is available. If
  // the network request succeeds, we also save a fresh copy into the cache
  // (under the plain name "index.html") so it's ready for next time we're
  // offline. If the network request fails — no connection — we fall back
  // to whatever copy of index.html we last cached.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((response) => {
          // Reviewer patch (WO6): only cache healthy responses, so a server
          // error page can never overwrite the good offline copy.
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put("index.html", copy));
          }
          return response;
        })
        .catch(() => caches.match("index.html"))
    );
    return;
  }

  // Rule 3: everything else same-origin (icons, the manifest file) goes
  // cache-first, since these files rarely change and loading them from
  // cache is instant. If a file isn't in the cache yet for some reason, we
  // fall back to fetching it from the network.
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});
