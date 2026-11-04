// workbox-build configuration for the phone's app shell — the file `scripts/generate-service-worker.mjs`
// hands to `workbox generateSW` at the end of every build.
//
// It is `.cjs`, not `.js`, for a measured reason: this package declares `"type": "module"`, so a `.js`
// config is parsed as an ES module and the CLI's `require()` of it dies with `module is not defined in
// ES module scope` (verified against workbox-cli 7.4.1 on this host). The old `workbox-config.js` could
// therefore never have been loaded, even had anything invoked it.
//
// WHAT THIS DELIBERATELY DOES NOT CACHE, AND WHY
//
// The daemon is data, and the phone cannot reach it yet (its bind/CORS/pairing work is another lane). A
// worker that answered a daemon request from a cache would show the owner a stale run list, a gate that
// has already been decided, a cost that has already moved — and the bench would say "the server answered"
// while the server was never asked. That is a lie about the owner's work, so there is no runtime caching
// of anything here: no `runtimeCaching` block at all, and the previous config's `warsha-api` NetworkFirst
// entry is gone rather than tuned.
//
// What is cached is the shell only, and precaching is the honest strategy for it: every URL is hashed by
// Vite at build time, so a cached `assets/index-<hash>.js` cannot be a stale copy of a different file —
// the hash changed, the entry changed, the worker updated. `index.html` is the one unhashed URL, and it
// is precached with its content hash as its revision, so a new build is a new entry.
//
// `navigateFallback` answers a *navigation* from that shell when the network is not there. It is scoped to
// navigations only (a fetch to the daemon is not a navigation, and the daemon lives on a different
// origin:port anyway), which is what lets `/settings` deep links work offline. The denylist is the
// co-hosting case: if a reverse proxy ever serves the PWA and the daemon from one origin, `/api`,
// `/events` and `/healthz` must reach the daemon rather than be handed the shell.
//
// `skipWaiting` + `clientsClaim` mean an updated shell takes control without waiting for the tab to
// close. It does not reload anything — a screen already in memory keeps running the code it loaded — so
// a decision mid-flight is not interrupted, and the next navigation is the new build.
module.exports = {
  globDirectory: 'dist/',
  // `sw.js` is what this command writes, so it is excluded by name rather than by a pattern that would
  // also have to be remembered if the bundle ever emits a second file next to it.
  globPatterns: ['**/*.{html,css,js,png,svg,webmanifest}'],
  globIgnores: ['sw.js'],
  swDest: 'dist/sw.js',
  clientsClaim: true,
  skipWaiting: true,
  navigateFallback: '/index.html',
  navigateFallbackDenylist: [/^\/api\//, /^\/events/, /^\/healthz/],
};
