// @warsha/remote — the serving half of the pairing reachability path.
//
// A pairing link is only worth scanning if the phone can actually open the app it points at.
// Vite binds `localhost` unless told otherwise, and a phone on the LAN is not `localhost` — so
// the app ships `dev:lan` / `preview:lan` as the *opt-in* LAN binds, and keeps the default
// `dev`/`preview` on loopback. That split is a DECISIONS.md rule ("any LAN bind must be opt-in
// and documented, not a silent `0.0.0.0`"), and the rule lives in two plain files
// (`vite.config.ts`, `package.json`) that no runtime test otherwise reads. This file is what
// makes the split un-silent: it pins which scripts may bind outward and which must not.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const CONFIG = readFileSync(join(__dirname, '..', 'vite.config.ts'), 'utf8');
const PKG = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

describe('the phone can be given a LAN origin, and nothing else does it silently', () => {
  it('offers an explicit LAN script for the dev server and for the built artifact', () => {
    // `dev:lan` serves the sources, `preview:lan` serves the built `dist/` — the exact tree
    // `check:pwa` validated (manifest, icons, `sw.js`). A phone pairs against one of these.
    expect(PKG.scripts['dev:lan']).toBe('vite --host');
    expect(PKG.scripts['preview:lan']).toBe('vite preview --host');
  });

  it('keeps the default scripts on loopback', () => {
    // The LAN bind is only ever what the operator asked for by name; `pnpm visual`, Playwright's
    // `webServer` and every CI lane use these two, and they must not start listening outward.
    expect(PKG.scripts.dev).toBe('vite');
    expect(PKG.scripts.preview).toBe('vite preview');
    expect(PKG.scripts.dev).not.toContain('--host');
    expect(PKG.scripts.preview).not.toContain('--host');
  });

  it('declares no host in the config, so the binding comes from the script, not the file', () => {
    // `host:` here would bind every invocation, including CI. The loopback default is vite's own
    // and stays vite's own; `--host` on the command line is the only way outward.
    expect(CONFIG).not.toMatch(/\bhost\s*:/);
  });

  it('serves the app on one stable port whichever server runs', () => {
    // A pairing instruction names `http://<pc-address>:5174/`; both servers answer it, and
    // `strictPort` means neither silently moves to another port the link would not carry.
    expect(CONFIG).toMatch(/server:\s*\{[^}]*port:\s*5174[^}]*strictPort:\s*true/s);
    expect(CONFIG).toMatch(/preview:\s*\{[^}]*port:\s*5174[^}]*strictPort:\s*true/s);
  });
});

describe('the served artifact is the one the PWA gate validated', () => {
  it('builds the service worker into dist before anything serves it', () => {
    // `preview:lan` serves `dist/`; the precached worker only exists there if the build emits it.
    expect(PKG.scripts.build).toContain('scripts/generate-service-worker.mjs');
    expect(PKG.scripts['check:pwa']).toBe('node scripts/verify-pwa.mjs');
  });
});
