// Minimal service worker: satisfies "installable PWA" criteria.
// Data is always fetched live from Supabase, so we deliberately don't cache
// app responses beyond letting the browser's normal HTTP cache do its thing.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
