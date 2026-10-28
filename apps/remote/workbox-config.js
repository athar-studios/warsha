module.exports = {
  globDirectory: 'dist/',
  globPatterns: [
    '**/*.{html,js,css,png,svg,ico,woff2}'
  ],
  swDest: 'dist/sw.js',
  clientsClaim: true,
  skipWaiting: true,
  runtimeCaching: [
    {
      urlPattern: /^https:\/\/.*\.warsha\.dev/,
      handler: 'NetworkFirst',
      options: {
        cacheName: 'warsha-api',
        expiration: {
          maxEntries: 100,
          maxAgeSeconds: 60 * 60 * 24 // 24 hours
        },
        networkTimeoutSeconds: 10
      }
    }
  ],
  manifestTransforms: [
    (manifestEntries) => {
      const manifest = manifestEntries.map(entry => {
        if (entry.url.endsWith('.html')) {
          entry.revision = null;
        }
        return entry;
      });
      return { manifest, warnings: [] };
    }
  ]
};