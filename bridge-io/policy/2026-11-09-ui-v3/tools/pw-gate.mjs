#!/usr/bin/env node
// Planner-owned gate tool for run 2026-11-09-ui-v3. Implementers must not edit it.
// Pure Node (>=18), no dependencies. Exit 0 = gate passes, 1 = gate fails, 2 = usage/input error.
//
//   node pw-gate.mjs failures  <playwright-report.json> <named-set.txt>
//       every UNEXPECTED (failed) case must match a regex line in named-set.txt;
//       prints "unexpected=<n> outside=<m>" and each case outside the set.
//   node pw-gate.mjs counts    <playwright-report.json> <min-passed> <max-failed>
//       stats.expected >= min-passed AND stats.unexpected <= max-failed (flaky counts as failed).
//   node pw-gate.mjs snapshots <base> <head> <allow.txt|-> [repo-dir]
//       every path changed under *-snapshots/ between base..head must match a regex line in
//       allow.txt; "-" means no snapshot change is allowed at all.
//   node pw-gate.mjs --self-test
//
// Case key matched by the regexes: "<project> › <spec file basename> › <title>",
// e.g. "desktop › screens.visual.spec.ts › settings 390x844 ar light".
// named-set / allow files: one JavaScript regex per line; blank lines and lines starting with # ignored.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';

const die = (msg) => { process.stderr.write(`pw-gate: ${msg}\n`); process.exit(2); };

export function loadPatterns(text) {
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => {
    try { return new RegExp(l); } catch (e) { return die(`bad regex "${l}": ${e.message}`); }
  });
}

export function collectCases(report) {
  const out = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const file = basename(String(spec.file ?? suite.file ?? '').replace(/\\/g, '/'));
        out.push({ key: `${t.projectName ?? '?'} › ${file} › ${spec.title}`, status: t.status });
      }
    }
    for (const s of suite.suites ?? []) walk(s);
  };
  for (const s of report.suites ?? []) walk(s);
  return out;
}

export function failuresOutside(report, patterns) {
  const bad = collectCases(report).filter((c) => c.status === 'unexpected' || c.status === 'flaky');
  const outside = bad.filter((c) => !patterns.some((p) => p.test(c.key)));
  return { unexpected: bad.length, outside: outside.map((c) => c.key) };
}

export function pathsOutside(paths, patterns) {
  return paths.filter((p) => /-snapshots\//.test(p)).filter((p) => !patterns.some((r) => r.test(p)));
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch (e) { return die(`cannot read ${path}: ${e.message}`); }
}

function selfTest() {
  const report = { suites: [{ file: 'desktop/e2e/screens.visual.spec.ts', specs: [
    { title: 'settings 390x844 ar light', file: 'desktop/e2e/screens.visual.spec.ts', tests: [{ projectName: 'desktop', status: 'unexpected' }] },
    { title: 'simple 390x844 ar light', file: 'desktop/e2e/screens.visual.spec.ts', tests: [{ projectName: 'desktop', status: 'expected' }] },
  ], suites: [{ specs: [{ title: 'gates parked 390x844', file: 'desktop\\e2e\\states.spec.ts', tests: [{ projectName: 'desktop', status: 'flaky' }] }] }] }],
  stats: { expected: 1, unexpected: 1, flaky: 1 } };
  const checks = [];
  const ok = (name, cond) => checks.push([name, !!cond]);
  const cases = collectCases(report);
  ok('collects nested specs', cases.length === 3);
  ok('normalises windows paths', cases[2].key === 'desktop › states.spec.ts › gates parked 390x844');
  const inSet = failuresOutside(report, loadPatterns('# c\n^desktop › screens\\.visual\\.spec\\.ts › settings \n^desktop › states\\.spec\\.ts › gates '));
  ok('all failures inside the set pass', inSet.unexpected === 2 && inSet.outside.length === 0);
  const outSet = failuresOutside(report, loadPatterns('^desktop › screens\\.visual\\.spec\\.ts › settings '));
  ok('a flaky case outside the set fails', outSet.outside.length === 1 && outSet.outside[0].includes('gates parked'));
  ok('empty set rejects every failure', failuresOutside(report, []).outside.length === 2);
  const snaps = ['apps/desktop/e2e/screens.visual.spec.ts-snapshots/settings-390x844-ar-light-desktop-linux.png', 'apps/desktop/src/App.tsx'];
  ok('non-snapshot paths are ignored', pathsOutside(snaps, loadPatterns('/settings-')).length === 0);
  ok('no allowlist rejects a snapshot change', pathsOutside(snaps, []).length === 1);
  for (const [n, pass] of checks) process.stdout.write(`${pass ? 'ok  ' : 'FAIL'} ${n}\n`);
  process.exit(checks.every(([, p]) => p) ? 0 : 1);
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === '--self-test') selfTest();
else if (cmd === 'failures') {
  if (args.length !== 2) die('usage: failures <report.json> <named-set.txt>');
  const r = failuresOutside(readJson(args[0]), loadPatterns(readFileSync(args[1], 'utf8')));
  process.stdout.write(`unexpected=${r.unexpected} outside=${r.outside.length}\n`);
  for (const k of r.outside) process.stdout.write(`OUTSIDE ${k}\n`);
  process.exit(r.outside.length === 0 ? 0 : 1);
} else if (cmd === 'counts') {
  if (args.length !== 3) die('usage: counts <report.json> <min-passed> <max-failed>');
  const s = readJson(args[0]).stats ?? die('report has no stats');
  const failed = (s.unexpected ?? 0) + (s.flaky ?? 0);
  process.stdout.write(`passed=${s.expected ?? 0} failed=${failed} skipped=${s.skipped ?? 0}\n`);
  process.exit((s.expected ?? 0) >= Number(args[1]) && failed <= Number(args[2]) ? 0 : 1);
} else if (cmd === 'snapshots') {
  if (args.length < 3) die('usage: snapshots <base> <head> <allow.txt|-> [repo-dir]');
  const [base, head, allow, dir = '.'] = args;
  const out = execFileSync('git', ['-C', dir, 'diff', '--name-only', `${base}..${head}`], { encoding: 'utf8' });
  const paths = out.split(/\r?\n/).filter(Boolean);
  const pats = allow === '-' ? [] : loadPatterns(readFileSync(allow, 'utf8'));
  const changed = paths.filter((p) => /-snapshots\//.test(p));
  const outside = pathsOutside(paths, pats);
  process.stdout.write(`snapshot_changes=${changed.length} outside=${outside.length}\n`);
  for (const p of outside) process.stdout.write(`OUTSIDE ${p}\n`);
  process.exit(outside.length === 0 ? 0 : 1);
} else die('unknown command; see the header of this file');
