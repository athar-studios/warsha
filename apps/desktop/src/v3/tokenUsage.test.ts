// apps/desktop/src/v3/tokenUsage.test.ts
// Design pass: every `var(--w-*)` the v3 app reads must be a token the v3 sheet declares. A v2-era name written
// with the v3 prefix (`--w-surface-2`, `--w-space-12`, `--w-warning`…) resolves to nothing, so the declaration
// silently falls back — a transparent card, a zero gap, an unfilled SVG marker — and no other check sees it.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO = resolve(__dirname, '../../../..');
const SCANNED = [resolve(__dirname), resolve(REPO, 'packages/ui/src/v3')];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(tsx?|css)$/.test(name) && !/\.(test|stories)\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

function declared(): Set<string> {
  const names = new Set<string>();
  for (const file of [resolve(REPO, 'packages/ui/src/v3/tokens/tokens.css'), ...SCANNED.flatMap((d) => walk(d))]) {
    for (const match of readFileSync(file, 'utf8').matchAll(/(--w-[a-z0-9-]+)\s*:/g)) names.add(match[1]);
  }
  return names;
}

describe('v3 token usage', () => {
  it('reads only declared --w-* tokens', () => {
    const known = declared();
    const unknown: string[] = [];
    for (const file of SCANNED.flatMap((d) => walk(d))) {
      for (const match of readFileSync(file, 'utf8').matchAll(/var\((--w-[a-z0-9-]+)/g)) {
        if (!known.has(match[1])) unknown.push(`${relative(REPO, file)}: ${match[1]}`);
      }
    }
    expect(unknown).toEqual([]);
  });
});
