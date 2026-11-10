#!/usr/bin/env node
// Planner-owned gate for run 2026-11-09-ui-v3 — "plain Arabic first" (DESIGN_SYSTEM_V3 §1.3, §4.4).
// Implementers must not edit it. Reads the v3 catalogs packages/i18n/src/v3/{ar,en}.ts, written as one
// `'key': 'value',` (or "key": "value") entry per line.
//   node i18n-gate.mjs [repo-dir]    exit 0 iff 0 violations
//   node i18n-gate.mjs --self-test
// I1 both files exist and parse to > 0 keys   I2 identical key sets   I3 no empty value
// I4 Arabic values contain no Latin word except the allow-list and {placeholders}   I5 English values contain no Arabic letter
// I6 placeholders ({name}) are identical per key in both languages
import { readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
const IS_MAIN = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

const ALLOW = ['MCP', 'API', 'GitHub', 'URL', 'JSON', 'QR', 'PWA', 'Git', 'Ollama'];

export function parse(src) {
  const map = new Map();
  for (const m of src.matchAll(/^\s*['"]?([a-z0-9_.-]+)['"]?\s*:\s*(['"`])((?:\\.|(?!\2).)*)\2\s*,?\s*$/gm)) map.set(m[1], m[3]);
  return map;
}
const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

// A locale is either one file v3/<l>.ts or a directory v3/<l>/*.ts (one file per area, preferred so page packets
// never edit the same file). Keys must be unique across the area files of one locale (I7).
function loadLocale(root, l, v) {
  const base = join(root, 'packages/i18n/src/v3');
  const files = existsSync(join(base, l)) ? readdirSync(join(base, l)).filter((n) => n.endsWith('.ts') && n !== 'index.ts').map((n) => join(base, l, n))
    : existsSync(join(base, `${l}.ts`)) ? [join(base, `${l}.ts`)] : [];
  const map = new Map();
  for (const f of files) for (const [k, s] of parse(readFileSync(f, 'utf8'))) { if (map.has(k)) v.push(`I7 duplicate ${l} key "${k}"`); map.set(k, s); }
  return { map, found: files.length > 0 };
}

export function check(root) {
  const v = [];
  const A = loadLocale(root, 'ar', v), E = loadLocale(root, 'en', v);
  if (!A.found || !E.found) return { v: ['I1 packages/i18n/src/v3/{ar,en}/ (or ar.ts/en.ts) must both exist'], n: 0 };
  const ar = A.map, en = E.map;
  if (ar.size === 0 || en.size === 0) v.push('I1 a catalog parsed to 0 keys (one `key: value,` per line)');
  for (const k of ar.keys()) if (!en.has(k)) v.push(`I2 key "${k}" is in ar but not en`);
  for (const k of en.keys()) if (!ar.has(k)) v.push(`I2 key "${k}" is in en but not ar`);
  for (const [k, s] of ar) {
    if (!s.trim()) v.push(`I3 ar "${k}" is empty`);
    let rest = s.replace(/\{\w+\}/g, '');
    for (const w of ALLOW) rest = rest.split(w).join('');
    if (/[A-Za-z]/.test(rest)) v.push(`I4 ar "${k}" contains Latin text: ${s}`);
    if (en.has(k) && ph(s) !== ph(en.get(k))) v.push(`I6 placeholders differ for "${k}"`);
  }
  for (const [k, s] of en) {
    if (!s.trim()) v.push(`I3 en "${k}" is empty`);
    if (/[؀-ۿ]/.test(s)) v.push(`I5 en "${k}" contains Arabic letters`);
  }
  return { v, n: ar.size };
}

function selfTest() {
  const root = mkdtempSync(join(tmpdir(), 'i18n-gate-'));
  const put = (l, s) => { mkdirSync(join(root, 'packages/i18n/src/v3'), { recursive: true }); writeFileSync(join(root, 'packages/i18n/src/v3', `${l}.ts`), s); };
  const checks = []; const ok = (n, c) => checks.push([n, !!c]);
  put('ar', "export const ar = {\n  'home.start': 'ابدأ',\n  'home.greeting': 'أهلًا {name}',\n  'settings.mcp': 'خوادم MCP',\n};\n");
  put('en', "export const en = {\n  'home.start': 'Start',\n  'home.greeting': 'Hello {name}',\n  'settings.mcp': 'MCP servers',\n};\n");
  ok('clean catalogs pass', check(root).v.length === 0 && check(root).n === 3);
  put('ar', "export const ar = {\n  'home.start': 'ابدأ Launch',\n  'home.greeting': 'أهلًا',\n  'settings.mcp': '',\n  'only.ar': 'فقط',\n};\n");
  const r = check(root).v;
  ok('I4 Latin word in Arabic', r.some((s) => s.startsWith('I4') && s.includes('home.start')));
  ok('I6 placeholder mismatch', r.some((s) => s.startsWith('I6')));
  ok('I3 empty value', r.some((s) => s.startsWith('I3')));
  ok('I2 key parity', r.some((s) => s.startsWith('I2')));
  put('en', "export const en = {\n  'home.start': 'ابدأ',\n};\n");
  ok('I5 Arabic in English', check(root).v.some((s) => s.startsWith('I5')));
  // per-area directories, duplicate key across area files
  rmSync(join(root, 'packages/i18n/src/v3'), { recursive: true, force: true });
  const area = (l, a, s) => { mkdirSync(join(root, 'packages/i18n/src/v3', l), { recursive: true }); writeFileSync(join(root, 'packages/i18n/src/v3', l, `${a}.ts`), s); };
  area('ar', 'home', "export default {\n  'home.start': 'ابدأ',\n};\n"); area('ar', 'inbox', "export default {\n  'inbox.empty': 'لا شيء ينتظرك',\n};\n");
  area('en', 'home', "export default {\n  'home.start': 'Start',\n};\n"); area('en', 'inbox', "export default {\n  'inbox.empty': 'Nothing is waiting for you',\n};\n");
  area('ar', 'index', "export * from './home';\n"); area('en', 'index', "export * from './home';\n");
  ok('area directories merge (index.ts ignored)', check(root).v.length === 0 && check(root).n === 2);
  area('ar', 'project', "export default {\n  'home.start': 'ابدأ الآن',\n};\n");
  ok('I7 duplicate key across area files', check(root).v.some((s) => s.startsWith('I7')));
  rmSync(root, { recursive: true, force: true });
  for (const [n, p] of checks) process.stdout.write(`${p ? 'ok  ' : 'FAIL'} ${n}\n`);
  process.exit(checks.every(([, p]) => p) ? 0 : 1);
}

if (IS_MAIN && process.argv[2] === '--self-test') selfTest();
else if (IS_MAIN) {
  const r = check(process.argv[2] ?? '.');
  for (const s of r.v) process.stdout.write(`${s}\n`);
  process.stdout.write(`i18n-v3: ${r.n} keys, ${r.v.length} violations\n`);
  process.exit(r.v.length === 0 ? 0 : 1);
}
