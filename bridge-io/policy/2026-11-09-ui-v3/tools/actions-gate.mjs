#!/usr/bin/env node
// Planner-owned gate for run 2026-11-09-ui-v3 — "every control works, or does not exist" (DESIGN_SYSTEM_V3 §1.2, §4.1).
// Implementers must not edit it. Node >= 18, no dependencies.
//   node actions-gate.mjs [repo-dir] [--only home.,project.]   exit 0 iff 0 violations
//   node actions-gate.mjs --self-test
// Checks over apps/desktop/src/v3/**/*.tsx (tests and stories excluded):
//   A1 every interactive JSX element (button, a, Button, IconButton, Link, MenuItem, Tab, *.Tab, or any tag with
//      onClick/onSubmit/onPress) carries a LITERAL data-action="page.verb" (forms are exempt; their submit button is not)
//   A2 no inert handler: onClick={() => {}}, () => undefined, () => null, or console.* inside the handler
//   A3 registry ids (apps/desktop/src/v3/actions/registry.ts, `id: '…'`) are unique
//   A4 every data-action used is registered; every registered id is used in src
//   A5 every rpc listed in the registry (`rpc: ['a.b', …]`) is served by the daemon (#[method(name = "a.b")]) and dialled by the client
//   A6 every registered id is referenced by at least one e2e file under apps/desktop/e2e/v3/
//   A7 no hard-coded model / workflow names in v3 source (the v2 FAKE lists)
import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
const IS_MAIN = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

const INTERACTIVE = /^(button|a|Button|IconButton|Link|MenuItem|Tab|[A-Z]\w*\.Tab|[A-Z]\w*\.Item)$/;
const FAKE = /DeepSeek|GPT-4o|Claude 3\.5|fleet-worktrees|graph-gated|ticket-to-pr|autonomous-factory|complex-workbench|solo-bench|sealed-envelope/;

function walk(dir, pred, out = []) {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== 'node_modules') walk(p, pred, out); } else if (pred(p)) out.push(p);
  }
  return out;
}

// Returns opening JSX tags: { name, attrs, line }.
export function jsxTags(src) {
  const tags = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== '<') continue;
    const prev = src[i - 1] ?? ' ';
    if (/[\w)\]]/.test(prev)) continue; // generics / comparisons
    const m = /^<([A-Za-z][\w.]*)/.exec(src.slice(i, i + 80));
    if (!m) continue;
    let j = i + m[0].length, depth = 0, quote = null;
    for (; j < src.length; j++) {
      const c = src[j];
      if (quote) { if (c === quote && src[j - 1] !== '\\') quote = null; continue; }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      if (c === '{') depth++; else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    tags.push({ name: m[1], attrs: src.slice(i + m[0].length, j), line: src.slice(0, i).split('\n').length });
    i = j;
  }
  return tags;
}

export function scanSource(file, src) {
  const v = [], used = [];
  for (const t of jsxTags(src)) {
    const handler = /\bon(Click|Submit|Press)\s*=/.test(t.attrs);
    if (t.name === 'form') continue;
    if (!(INTERACTIVE.test(t.name) || handler)) continue;
    const lit = /data-action\s*=\s*"([a-z0-9-]+(?:\.[a-z0-9-]+)+)"/.exec(t.attrs);
    if (!lit) v.push(`A1 ${file}:${t.line} <${t.name}> has no literal data-action="page.verb"`);
    else used.push(lit[1]);
    if (/on(Click|Submit|Press)\s*=\s*\{\s*\(\s*\)\s*=>\s*(\{\s*\}|undefined|null)\s*\}/.test(t.attrs) || /on(Click|Submit|Press)\s*=\s*\{[^}]*console\./.test(t.attrs))
      v.push(`A2 ${file}:${t.line} <${t.name}> has an inert or console-only handler`);
  }
  if (FAKE.test(src)) v.push(`A7 ${file} contains a hard-coded model/workflow name (${FAKE.exec(src)[0]})`);
  return { v, used };
}

// `only`: optional list of id prefixes (e.g. ['home.', 'project.']). When given, A4-unused and A6 are judged only
// for registered ids with those prefixes (a page packet is not blamed for pages it does not own); A1, A2, A3, A5, A7
// and A4-unregistered always apply to the whole v3 tree.
export function check(root, only = null) {
  const v = [];
  const rel = (p) => relative(root, p).replace(/\\/g, '/');
  const owned = (id) => !only || only.some((p) => id.startsWith(p));
  const srcFiles = walk(join(root, 'apps/desktop/src/v3'), (p) => /\.tsx$/.test(p) && !/\.(test|stories)\.tsx$/.test(p));
  const usedAll = new Set();
  for (const f of srcFiles) { const r = scanSource(rel(f), readFileSync(f, 'utf8')); v.push(...r.v); r.used.forEach((u) => usedAll.add(u)); }
  // The registry is one file per area under actions/registry/ (preferred) or a single actions/registry.ts.
  const regDir = join(root, 'apps/desktop/src/v3/actions/registry');
  const regFile = join(root, 'apps/desktop/src/v3/actions/registry.ts');
  const regFiles = existsSync(regDir) ? walk(regDir, (p) => /\.ts$/.test(p) && !/\.test\.ts$/.test(p)) : existsSync(regFile) ? [regFile] : [];
  if (regFiles.length === 0) return { v: [...v, 'A3 registry apps/desktop/src/v3/actions/registry/ (or registry.ts) is missing'], ids: [], elements: usedAll.size };
  const reg = regFiles.map((f) => readFileSync(f, 'utf8')).join('\n');
  const ids = [...reg.matchAll(/\bid:\s*['"]([a-z0-9-]+(?:\.[a-z0-9-]+)+)['"]/g)].map((m) => m[1]);
  const seen = new Set();
  for (const id of ids) { if (seen.has(id)) v.push(`A3 duplicate registry id ${id}`); seen.add(id); }
  for (const u of usedAll) if (!seen.has(u)) v.push(`A4 data-action "${u}" is not registered`);
  for (const id of seen) if (owned(id) && !usedAll.has(id)) v.push(`A4 registered id "${id}" is not used by any v3 element`);
  const daemon = walk(join(root, 'crates/warshad/src'), (p) => p.endsWith('.rs')).map((f) => readFileSync(f, 'utf8')).join('\n');
  const served = new Set([...daemon.matchAll(/#\[method\(name\s*=\s*"([a-z_.-]+)"/g)].map((m) => m[1]));
  const clientPath = join(root, 'packages/client/src/index.ts');
  const client = existsSync(clientPath) ? readFileSync(clientPath, 'utf8') : '';
  for (const m of reg.matchAll(/\brpc:\s*\[([^\]]*)\]/g)) {
    for (const r of [...m[1].matchAll(/['"]([a-z_.-]+)['"]/g)].map((x) => x[1])) {
      if (!served.has(r)) v.push(`A5 rpc "${r}" is not served by the daemon`);
      if (!client.includes(`'${r}'`) && !client.includes(`"${r}"`)) v.push(`A5 rpc "${r}" is not dialled by packages/client`);
    }
  }
  const e2e = walk(join(root, 'apps/desktop/e2e/v3'), (p) => /\.ts$/.test(p)).map((f) => readFileSync(f, 'utf8')).join('\n');
  for (const id of seen) if (owned(id) && !e2e.includes(id)) v.push(`A6 registered id "${id}" has no e2e case under apps/desktop/e2e/v3/`);
  return { v, ids, elements: usedAll.size };
}

function selfTest() {
  const root = mkdtempSync(join(tmpdir(), 'actions-gate-'));
  const put = (p, s) => { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), s); };
  put('crates/warshad/src/lib.rs', '#[method(name = "projects.create")]\n#[method(name = "runs.start")]');
  put('packages/client/src/index.ts', "const A = 'projects.create'; const B = 'runs.start';");
  put('apps/desktop/src/v3/actions/registry.ts', "export const ACTIONS = [\n { id: 'home.start', effect: 'rpc', rpc: ['projects.create', 'runs.start'] },\n { id: 'home.open', effect: 'nav' },\n];");
  put('apps/desktop/src/v3/pages/Home.tsx', 'export const H = () => (<div>\n<Button data-action="home.start" onClick={() => start(x => x > 1)}>go</Button>\n<a href="#/p" data-action="home.open">p</a>\n<input onChange={e => set(e.target.value)} />\n</div>);');
  put('apps/desktop/e2e/v3/home.spec.ts', "click('home.start'); click('home.open');");
  const checks = [];
  const ok = (n, c) => checks.push([n, !!c]);
  let r = check(root);
  ok('clean fixture passes', r.v.length === 0 && r.ids.length === 2 && r.elements === 2);
  put('apps/desktop/src/v3/pages/Bad.tsx', 'export const B = () => (<>\n<button onClick={() => {}}>x</button>\n<IconButton data-action="home.ghost" onClick={() => console.log(1)} />\n<span>DeepSeek V3</span>\n</>);');
  r = check(root);
  ok('A1 missing data-action', r.v.some((s) => s.startsWith('A1') && s.includes('Bad.tsx:2')));
  ok('A2 inert handler', r.v.filter((s) => s.startsWith('A2')).length === 2);
  ok('A4 unregistered id', r.v.some((s) => s.includes('"home.ghost" is not registered')));
  ok('A7 fake model name', r.v.some((s) => s.startsWith('A7')));
  rmSync(join(root, 'apps/desktop/src/v3/pages/Bad.tsx'));
  put('apps/desktop/src/v3/actions/registry.ts', "export const ACTIONS = [\n { id: 'home.start', effect: 'rpc', rpc: ['projects.create', 'runs.start', 'deploy.web'] },\n { id: 'home.open', effect: 'nav' },\n { id: 'home.open', effect: 'nav' },\n { id: 'home.unused', effect: 'state' },\n];");
  r = check(root);
  ok('A3 duplicate id', r.v.some((s) => s.startsWith('A3 duplicate')));
  ok('A4 unused id', r.v.some((s) => s.includes('"home.unused" is not used')));
  ok('A5 rpc not served', r.v.some((s) => s.includes('"deploy.web" is not served')));
  ok('A6 no e2e case', r.v.some((s) => s.startsWith('A6') && s.includes('home.unused')));
  // per-area registry directory + --only + hyphenated method names
  rmSync(join(root, 'apps/desktop/src/v3/actions/registry.ts'));
  put('crates/warshad/src/lib.rs', '#[method(name = "projects.create")]\n#[method(name = "runs.start")]\n#[method(name = "devices.pair-start")]');
  put('packages/client/src/index.ts', "const A = 'projects.create'; const B = 'runs.start'; const C = 'devices.pair-start';");
  put('apps/desktop/src/v3/actions/registry/home.ts', "export const HOME = [\n { id: 'home.start', effect: 'rpc', rpc: ['projects.create', 'runs.start'] },\n { id: 'home.open', effect: 'nav' },\n];");
  put('apps/desktop/src/v3/actions/registry/settings.ts', "export const SETTINGS = [\n { id: 'settings.device.pair', effect: 'rpc', rpc: ['devices.pair-start'] },\n];");
  r = check(root);
  ok('registry dir is read and hyphenated rpc is served', r.ids.length === 3 && !r.v.some((s) => s.startsWith('A5')));
  ok('an unbuilt page fails without --only', r.v.some((s) => s.includes('"settings.device.pair" is not used')));
  r = check(root, ['home.']);
  ok('--only home. ignores the unbuilt settings page', r.v.length === 0);
  rmSync(root, { recursive: true, force: true });
  for (const [n, p] of checks) process.stdout.write(`${p ? 'ok  ' : 'FAIL'} ${n}\n`);
  process.exit(checks.every(([, p]) => p) ? 0 : 1);
}

if (IS_MAIN && process.argv[2] === '--self-test') selfTest();
else if (IS_MAIN) {
  const args = process.argv.slice(2);
  const oi = args.indexOf('--only');
  const only = oi >= 0 ? args[oi + 1].split(',').map((s) => s.trim()).filter(Boolean) : null;
  const root = args.find((a, i) => !a.startsWith('--') && i !== oi + 1) ?? '.';
  const r = check(root, only);
  for (const s of r.v) process.stdout.write(`${s}\n`);
  process.stdout.write(`actions: ${r.ids.length} registered, ${r.elements} used, ${r.v.length} violations\n`);
  process.exit(r.v.length === 0 ? 0 : 1);
}
