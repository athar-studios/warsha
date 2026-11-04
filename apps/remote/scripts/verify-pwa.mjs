// The installability gate for the phone's app. It reads the BUILT `dist/`, never the source tree —
// `index.html` can declare a manifest that no build emits, and that is precisely the defect this file
// exists to make impossible to miss.
//
//     pnpm --filter warsha-remote build
//     pnpm --filter warsha-remote check:pwa             # the artifact half
//     pnpm --filter warsha-remote check:pwa -- --browser  # + register the worker in chromium
//
// The artifact half is pure file reading, so it runs anywhere a build ran. The browser half needs the
// repository's own Playwright chromium (installed by `pnpm install`; nothing is downloaded here) and a
// loopback HTTP server this script starts itself, because a service worker cannot register from a
// `file://` page. `localhost` is a secure context, so this proves registration on a machine with no
// certificate and no phone — what it cannot prove from here is a real Android install, which needs the
// daemon reachable from the phone (another lane) and a host serving the manifest as
// `application/manifest+json`.
//
// Exit 0 means every line printed PASS. Anything else prints what was expected and what was found.
import { createRequire } from 'node:module';
import { readFile, readdir, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = path.join(packageRoot, 'dist');

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined || detail === '' ? '' : ` — ${detail}`}`);
}

/** `/icons/icon-192.png` -> `icons/icon-192.png`: how a manifest URL maps onto `dist/`. */
function toDistPath(url) {
  if (typeof url !== 'string' || !url.startsWith('/')) return null;
  const clean = url.split('?')[0].split('#')[0].replace(/^\/+/, '');
  return clean === '' ? 'index.html' : clean;
}

/** PNG dimensions straight from the IHDR chunk: a `sizes` value the file disagrees with is an icon
 *  Chrome drops rather than resizes, and no image library is needed to catch that. */
function pngDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24 || buffer.toString('latin1', 12, 16) !== 'IHDR') return null;
  return `${String(buffer.readUInt32BE(16))}x${String(buffer.readUInt32BE(20))}`;
}

/** The precached URLs workbox wrote into `sw.js`, normalised to `dist/`-relative paths. */
function precachedUrls(swSource) {
  return [...swSource.matchAll(/\{url:"([^"]+)",revision:"[a-f0-9]+"}/g)].map((match) => match[1].replace(/^\/+/, ''));
}

async function walk(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const from = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await walk(from)));
    else found.push(path.relative(distRoot, from).split(path.sep).join('/'));
  }
  return found;
}

// ------------------------------------------------------------------------ the artifact half

function checkArtifacts({ files, manifest, manifestError, swSource, html, iconBytes }) {
  record(
    'dist/ carries the manifest the page links',
    files.includes('manifest.webmanifest'),
    files.includes('manifest.webmanifest') ? 'dist/manifest.webmanifest' : 'no dist/manifest.webmanifest'
  );
  record('the manifest is strict JSON', manifest !== null, manifestError ?? `${String(Object.keys(manifest ?? {}).length)} keys`);
  if (manifest === null) return;

  const missingTop = ['name', 'short_name', 'start_url', 'display'].filter(
    (key) => typeof manifest[key] !== 'string' || manifest[key] === ''
  );
  record(
    'the manifest has name, short_name, start_url and display',
    missingTop.length === 0,
    missingTop.length === 0 ? `display=${String(manifest.display)} start_url=${String(manifest.start_url)}` : `missing ${missingTop.join(', ')}`
  );

  const arabic = /[؀-ۿ]/;
  record(
    'the manifest names the app in Arabic, RTL',
    arabic.test(String(manifest.name)) && arabic.test(String(manifest.short_name)) && manifest.lang === 'ar' && manifest.dir === 'rtl',
    `short_name=${String(manifest.short_name)} lang=${String(manifest.lang)} dir=${String(manifest.dir)}`
  );

  const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
  const edges = icons.map((icon) => String(icon?.sizes));
  const wantedSizes = ['192x192', '512x512'].filter((size) => !edges.includes(size));
  record(
    'the manifest declares 192 and 512 icons',
    wantedSizes.length === 0,
    wantedSizes.length === 0 ? edges.join(', ') : `no entry for ${wantedSizes.join(', ')} (found ${edges.join(', ') || 'nothing'})`
  );
  record(
    'one of them is maskable',
    icons.some((icon) => String(icon?.purpose) === 'maskable'),
    'an Android launcher masks whatever it is given; without a maskable plate the corners are cropped content'
  );

  const badIcon = icons.find((icon) => {
    const relative = toDistPath(icon?.src);
    return relative === null || !files.includes(relative);
  });
  record(
    'every icon the manifest names exists in dist/',
    badIcon === undefined,
    badIcon === undefined ? icons.map((icon) => `${icon.src}`).join(', ') : `${String(badIcon?.src)} is not in dist/`
  );

  const sizeMismatch = icons.find((icon) => {
    const relative = toDistPath(icon?.src);
    return relative !== null && files.includes(relative) && pngDimensions(iconBytes.get(icon.src)) !== String(icon.sizes);
  });
  record(
    'each PNG really is the size it declares',
    sizeMismatch === undefined,
    sizeMismatch === undefined
      ? icons.map((icon) => `${icon.src}=${pngDimensions(iconBytes.get(icon.src))}`).join(', ')
      : `${String(sizeMismatch.src)} is ${pngDimensions(iconBytes.get(sizeMismatch.src))}, manifest says ${String(sizeMismatch.sizes)}`
  );

  const startFile = toDistPath(manifest.start_url);
  record(
    'start_url resolves to a file in dist/',
    startFile !== null && files.includes(startFile),
    `${String(manifest.start_url)} -> dist/${String(startFile)}`
  );
  record(
    'scope is inside the worker scope',
    manifest.scope === '/' || manifest.scope === undefined,
    `scope=${String(manifest.scope)}`
  );

  record(
    'a service worker was emitted',
    files.includes('sw.js') && typeof swSource === 'string' && swSource.length > 0,
    files.includes('sw.js') ? `dist/sw.js, ${String(swSource.length)} bytes` : 'no dist/sw.js — the build did not run workbox'
  );
  if (typeof swSource !== 'string') return;

  const precached = precachedUrls(swSource);
  const wantedPrecache = ['index.html', 'manifest.webmanifest', ...icons.map((icon) => toDistPath(icon.src)).filter((src) => src !== null)];
  const notPrecached = wantedPrecache.filter((relative) => !precached.includes(relative));
  record(
    'the worker precaches the shell, the manifest and the icons',
    notPrecached.length === 0,
    notPrecached.length === 0 ? `${String(precached.length)} URLs precached` : `absent from the precache: ${notPrecached.join(', ')}`
  );

  const referenced = [...(html ?? '').matchAll(/(?:src|href)="(\/[^"?#][^"]*)"/g)]
    .map((match) => match[1].replace(/^\/+/, ''))
    .filter((ref) => files.includes(ref));
  const assetsNotPrecached = referenced.filter((ref) => !precached.includes(ref));
  record(
    'the assets index.html loads are precached',
    assetsNotPrecached.length === 0,
    `${referenced.join(', ')}${assetsNotPrecached.length > 0 ? ` — missing: ${assetsNotPrecached.join(', ')}` : ''}`
  );

  // The rule in workbox-config.cjs, checked against the bytes it produced: shell only. A runtime
  // strategy would let the bench show a cached answer as if the daemon had given it.
  const banned = ['NetworkFirst', 'StaleWhileRevalidate', 'NetworkOnly', 'CacheFirst', 'CacheableResponse', 'warsha-api', 'runtimeCaching'];
  const found = banned.filter((term) => swSource.includes(term));
  const routes = swSource.match(/registerRoute/g) ?? [];
  record(
    'the worker caches no daemon data',
    found.length === 0 && routes.length === 1 && swSource.includes('NavigationRoute'),
    found.length > 0
      ? `worker contains ${found.join(', ')}`
      : `precaching only: ${String(precached.length)} URLs, one NavigationRoute, no runtime strategy`
  );

  const wantedTags = [
    '<html lang="ar" dir="rtl">',
    'viewport-fit=cover',
    'media="(prefers-color-scheme: light)"',
    'media="(prefers-color-scheme: dark)"',
    'rel="manifest"',
    'rel="apple-touch-icon"',
    'name="mobile-web-app-capable"',
  ];
  const missingTags = wantedTags.filter((fragment) => !(html ?? '').includes(fragment));
  record(
    'index.html keeps its language, viewport, theme and install tags',
    missingTags.length === 0,
    missingTags.length === 0 ? `${String(wantedTags.length)} fragments` : `missing: ${missingTags.join(' | ')}`
  );
}

// ------------------------------------------------------------------------ the browser half

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/**
 * A build served over `http://localhost`, exactly-files-only.
 *
 * No SPA fallback and no directory index beyond `/`: whatever a deep link answers here, the worker
 * answered it. A service worker needs a real origin, and `localhost` is a trustworthy one.
 */
function serveDist() {
  const server = http.createServer((request, response) => {
    const requested = decodeURIComponent((request.url ?? '/').split('?')[0]);
    const relative = requested === '/' ? 'index.html' : requested.replace(/^\/+/, '');
    const candidate = path.resolve(distRoot, relative);
    if (!candidate.startsWith(distRoot + path.sep)) {
      response.writeHead(403).end('forbidden');
      return;
    }
    readFile(candidate)
      .then((body) => {
        const type = CONTENT_TYPES[path.extname(candidate).toLowerCase()] ?? 'application/octet-stream';
        response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }).end(body);
      })
      .catch(() => {
        response.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      });
  });

  return new Promise((resolve) => {
    server.listen(0, 'localhost', () => {
      const address = server.address();
      resolve({ server, origin: `http://localhost:${String(address.port)}` });
    });
  });
}

async function poll(read, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== null && value !== false && value !== undefined) return value;
    if (Date.now() > deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function checkBrowser() {
  const require = createRequire(import.meta.url);
  let chromium;
  try {
    ({ chromium } = require('@playwright/test'));
  } catch (error) {
    record('browser half', false, `@playwright/test is not resolvable: ${String(error.message)}`);
    return null;
  }

  const { server, origin } = await serveDist();
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(String(error.message)));

    await page.goto(`${origin}/`, { waitUntil: 'load' });

    const registration = await poll(
      () =>
        page.evaluate(async () => {
          if (!('serviceWorker' in navigator)) return null;
          const found = await navigator.serviceWorker.getRegistration();
          if (!found || !found.active) return null;
          return { scope: found.scope, active: found.active.scriptURL };
        }),
      8000
    );
    record(
      'navigator.serviceWorker.getRegistration() resolves against the served page',
      registration !== null,
      registration === null ? 'no active registration within 8s' : `active=${registration.active} scope=${registration.scope}`
    );

    // `clientsClaim` should take the open tab; if the claim landed after the check, a reload says the
    // same thing the next navigation would.
    let controller = await poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null), 3000);
    if (controller === null) {
      await page.reload({ waitUntil: 'load' });
      controller = await poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null), 5000);
    }
    record('the worker controls the page', controller !== null, controller === null ? 'controller stayed null' : `controller=${controller}`);

    const cacheReport = await page.evaluate(async () => {
      const names = await caches.keys();
      const counts = {};
      for (const name of names) counts[name] = (await (await caches.open(name)).keys()).length;
      return { names, counts };
    });
    record(
      'the shell cache is populated',
      cacheReport.names.some((name) => name.toLowerCase().includes('precache')) &&
        Object.values(cacheReport.counts).some((count) => count > 0),
      Object.entries(cacheReport.counts)
        .map(([name, count]) => `${name}=${String(count)}`)
        .join(', ')
    );

    const manifestType = await page.evaluate(async (url) => (await fetch(url)).headers.get('content-type'), `${origin}/manifest.webmanifest`);
    record(
      'the manifest arrives as application/manifest+json',
      typeof manifestType === 'string' && manifestType.includes('manifest+json'),
      `content-type=${String(manifestType)} — Chrome refuses a manifest served as text/plain, so the real host must send this too`
    );

    await page.goto(`${origin}/settings`, { waitUntil: 'load' });
    const deepLink = await page.evaluate(() => document.getElementById('root')?.childElementCount ?? 0);
    record(
      'a deep link is answered by the worker, not by the host',
      deepLink > 0,
      `#root had ${String(deepLink)} children at /settings (this server 404s that path)`
    );

    // Everything above happened with a network; everything below deliberately has none.
    const onlineErrors = consoleErrors.slice();
    record('the served page logs no console error', onlineErrors.length === 0, onlineErrors.slice(0, 3).join(' | '));

    await context.setOffline(true);
    await page.goto(`${origin}/`, { waitUntil: 'load' });
    const offlineChildren = await page.evaluate(() => document.getElementById('root')?.childElementCount ?? 0);
    record('the shell opens with no network at all', offlineChildren > 0, `#root had ${String(offlineChildren)} children offline`);

    // The other half of the promise: offline must not look like an answer.
    const daemonAnswer = await page.evaluate(async (url) => {
      try {
        const response = await fetch(url, { method: 'POST', body: '{}' });
        return `status ${String(response.status)} from ${response.url}`;
      } catch {
        return null;
      }
    }, `${origin}/rpc`);
    record(
      'an offline daemon request fails rather than being answered from cache',
      daemonAnswer === null,
      daemonAnswer === null ? 'the fetch rejected, as it must' : `the worker answered: ${daemonAnswer}`
    );
    await context.setOffline(false);

    // The offline phase is allowed to log — it has no network. What it must not do is log something
    // that means the worker lied or the shell broke: every entry here is a real request that really
    // failed. The two expected ones are the Google Fonts stylesheet and its font files, which are not
    // precached (see workbox-config.cjs), so an offline first paint falls back to the device's own
    // Arabic face rather than to a cached copy of somebody else's.
    const offlineErrors = consoleErrors.slice(onlineErrors.length);
    record(
      'offline logs only requests that genuinely failed',
      offlineErrors.every((message) => message.includes('ERR_INTERNET_DISCONNECTED')),
      offlineErrors.length === 0 ? 'nothing logged' : `${String(offlineErrors.length)} logged: ${offlineErrors.map((message) => message.slice(0, 48)).join(' | ')}`
    );
    return origin;
  } finally {
    await browser.close();
    server.close();
  }
}

// ------------------------------------------------------------------------ runner

async function main() {
  let isDirectory = false;
  try {
    isDirectory = (await stat(distRoot)).isDirectory();
  } catch {
    isDirectory = false;
  }
  if (!isDirectory) {
    console.error(`FAIL  dist/ — ${distRoot} is not a directory. Run: pnpm --filter warsha-remote build`);
    process.exit(1);
  }

  const files = (await walk(distRoot)).sort();
  console.log(`dist/ listing (${String(files.length)} files):`);
  for (const file of files) {
    const info = await stat(path.join(distRoot, file));
    console.log(`  ${String(info.size).padStart(9)} B  ${file}`);
  }

  let manifest = null;
  let manifestError = '';
  if (files.includes('manifest.webmanifest')) {
    const text = await readFile(path.join(distRoot, 'manifest.webmanifest'), 'utf8');
    try {
      manifest = JSON.parse(text);
    } catch (error) {
      manifestError = String(error.message);
    }
  }
  // Read separately from the parsed manifest: the manifest is printed verbatim below, and a Buffer
  // hanging off an icon entry would print as ten thousand numbers.
  const iconBytes = new Map();
  if (manifest !== null && Array.isArray(manifest.icons)) {
    for (const icon of manifest.icons) {
      const relative = toDistPath(icon?.src);
      if (relative !== null && files.includes(relative)) {
        iconBytes.set(icon.src, await readFile(path.join(distRoot, relative)));
      }
    }
  }

  const swSource = files.includes('sw.js') ? await readFile(path.join(distRoot, 'sw.js'), 'utf8') : undefined;
  const html = files.includes('index.html') ? await readFile(path.join(distRoot, 'index.html'), 'utf8') : undefined;

  console.log('\nshipped manifest:');
  console.log(JSON.stringify(manifest ?? { error: manifestError }, null, 2));
  console.log('');

  checkArtifacts({ files, manifest, manifestError, swSource, html, iconBytes });

  if (process.argv.includes('--browser')) {
    console.log('');
    const origin = await checkBrowser();
    if (origin !== null) console.log(`\nbuild served at ${origin}`);
  } else {
    console.log('\n(SKIP browser half — add --browser to register the worker in chromium)');
  }

  const failed = results.filter((entry) => !entry.ok);
  console.log(`\n${String(results.length - failed.length)} of ${String(results.length)} checks passed`);
  if (failed.length > 0) console.log(`failed: ${failed.map((entry) => entry.name).join(', ')}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

void main();
