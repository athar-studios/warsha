// Generates `dist/sw.js` after `vite build`, from `workbox-config.cjs`.
//
// Run by the package's `build` script; it is not a dev-server step, so nothing about `vite.config.ts`
// changed and the remote e2e suite (which runs `pnpm --filter warsha-remote dev` on port 5174) never
// sees it.
//
// Why the CLI and not `import { generateSW } from 'workbox-build'`: this package declares
// `workbox-cli` (package.json devDependencies, locked at 7.4.1), and `workbox-build` is *its*
// dependency — not one this package can import under pnpm's strict linking, and adding it would be a
// new dependency for no gain. So this script resolves the declared package's own bin and runs it with
// the current Node: same `generateSW`, no PATH assumption, no shell quoting, the same on Linux, macOS
// and Windows.
//
// `NO_UPDATE_NOTIFIER` is not decoration: workbox-cli's bin calls `update-notifier(...).notify()` on
// every run, which asks the npm registry whether a newer workbox exists. A build must not make a
// network call to find out whether it is allowed to run offline.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const cliEntry = require.resolve('workbox-cli/build/bin.js');
const config = 'workbox-config.cjs';

const result = spawnSync(process.execPath, [cliEntry, 'generateSW', config], {
  cwd: packageRoot,
  stdio: 'inherit',
  env: { ...process.env, NO_UPDATE_NOTIFIER: '1' },
});

if (result.error !== null && result.error !== undefined) {
  console.error(`generate-service-worker: could not run ${cliEntry}: ${result.error.message}`);
  process.exit(1);
}

if (result.status !== 0) {
  console.error(
    `generate-service-worker: workbox generateSW ${config} exited with status ${String(result.status)}`
  );
  process.exit(result.status ?? 1);
}
