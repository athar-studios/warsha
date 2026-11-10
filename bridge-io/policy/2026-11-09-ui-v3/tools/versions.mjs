#!/usr/bin/env node
// Planner-owned gate tool for run 2026-11-09-ui-v3. Implementers must not edit it.
// Reads every place a Warsha component version is declared and compares them.
//   node versions.mjs [repo-dir]                  -> prints the table; exit 0 iff all equal
//   node versions.mjs [repo-dir] --expect 0.3.0   -> exit 0 iff all equal AND equal to 0.3.0
// The APK versionCode must equal major*10000 + minor*100 + patch (planner decision, DECISIONS 2026-11-09).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const expectIdx = argv.indexOf('--expect');
const expected = expectIdx >= 0 ? argv[expectIdx + 1] : null;
const dir = argv.find((a, i) => !a.startsWith('--') && i !== expectIdx + 1) ?? '.';
const read = (p) => (existsSync(join(dir, p)) ? readFileSync(join(dir, p), 'utf8') : null);
const rows = [];
const add = (file, value) => rows.push({ file, value: value ?? 'MISSING' });

const cargo = read('Cargo.toml');
add('Cargo.toml [workspace.package]', cargo?.match(/\[workspace\.package\][^[]*?\nversion\s*=\s*"([^"]+)"/s)?.[1]);
add('apps/desktop/src-tauri/Cargo.toml', read('apps/desktop/src-tauri/Cargo.toml')?.match(/\[package\][^[]*?\nversion\s*=\s*"([^"]+)"/s)?.[1]);
const tauri = read('apps/desktop/src-tauri/tauri.conf.json');
add('apps/desktop/src-tauri/tauri.conf.json', tauri ? JSON.parse(tauri).version : null);
for (const p of ['package.json', 'apps/desktop/package.json', 'apps/remote/package.json',
  'packages/ui/package.json', 'packages/client/package.json', 'packages/i18n/package.json', 'packages/crypto/package.json']) {
  const t = read(p); add(p, t ? JSON.parse(t).version : null);
}
const gradle = read('apps/mobile/android/app/build.gradle');
const versionName = gradle?.match(/versionName\s+["']([^"']+)["']/)?.[1];
const versionCode = gradle?.match(/versionCode\s+(\d+)/)?.[1];
add('apps/mobile/android/app/build.gradle versionName', versionName);
add('docker/compose.yml warshad image tag', read('docker/compose.yml')?.match(/warsha\/warshad:([0-9][^\s"']*)/)?.[1]);

const reference = rows[0].value;
const width = Math.max(...rows.map((r) => r.file.length));
for (const r of rows) process.stdout.write(`${r.file.padEnd(width)}  ${r.value}${r.value === reference ? '' : '   <-- differs'}\n`);
const [ma, mi, pa] = String(reference).split('.').map(Number);
const wantCode = String(ma * 10000 + mi * 100 + pa);
process.stdout.write(`${'apps/mobile versionCode'.padEnd(width)}  ${versionCode ?? 'MISSING'} (want ${wantCode})\n`);
const allEqual = rows.every((r) => r.value === reference) && versionCode === wantCode;
const ok = allEqual && (expected === null || reference === expected);
process.stdout.write(`versions: ${ok ? 'aligned' : 'NOT aligned'}${expected ? ` (expected ${expected})` : ''}\n`);
process.exit(ok ? 0 : 1);
