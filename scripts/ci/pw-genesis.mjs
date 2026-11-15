#!/usr/bin/env node
// Planner-owned gate tool for run 2026-11-09-ui-v3 (added 2026-11-10 by the planner of record).
// Implementers and orchestrators must not edit it. Pure Node (>=18), no dependencies.
// Exit 0 = gate passes, 1 = gate fails, 2 = usage/input error.
//
// WHY: `pw-gate.mjs failures <report> named/<P>.txt` fences WHICH cases may fail in a genesis
// capture, but not WHY they fail. A named `@visual` case that fails a layout, clipping, font or
// a11y assertion passes that fence exactly like a case whose only problem is a missing baseline.
// On 2026-11-10 this let 8 broken Workbench renders (text boxes 0px wide at 390x844) be judged
// "inside the set" and frozen as baselines (gates/U4.pw.json, gates/RU4.update.log).
//
//   node pw-genesis.mjs check <playwright-report.json> [pool.txt]
//       every UNEXPECTED or FLAKY case must fail ONLY because its snapshot does not exist yet.
//       Any other error on such a case is a product or test defect, never genesis.
//       With pool.txt (one JavaScript regex per line, same case key as pw-gate:
//       "<project> › <spec file basename> › <title>") only cases matching the pool are judged;
//       the others are left to pw-gate's own fence.
//       prints "unexpected=<n> judged=<j> genesis_only=<g> defective=<d>" and each defective case.
//   node pw-genesis.mjs --self-test
//
// Use it IN ADDITION to pw-gate (never instead of it) on every genesis capture, and require the
// `--update-snapshots` run itself to exit 0 before any snapshot is copied or committed.
import { readFileSync } from 'node:fs';

const die = (msg) => {
  process.stderr.write(`pw-genesis: ${msg}\n`);
  process.exit(2);
};

const ESC = String.fromCharCode(27);
const stripAnsi = (s) =>
  String(s ?? '')
    .split(ESC)
    .map((part, i) => (i === 0 ? part : part.replace(/^\[[0-9;]*m/, '')))
    .join('');
const baseName = (f) => String(f ?? '').split(/[\\/]/).pop();
const firstLine = (s) => stripAnsi(s).split('\n')[0].trim();

// Playwright's message for a baseline that is not on disk yet.
export const isGenesisError = (message) => /snapshot doesn't exist/i.test(stripAnsi(message));

export function loadPool(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      try {
        return new RegExp(l);
      } catch (e) {
        return die(`bad regex "${l}": ${e.message}`);
      }
    });
}

// pool = null judges every failed case; otherwise only the cases whose key matches a pool regex.
export function classify(report, pool = null) {
  const out = { unexpected: 0, judged: 0, genesisOnly: 0, defective: [] };
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        if (t.status !== 'unexpected' && t.status !== 'flaky') continue;
        out.unexpected += 1;
        const key = `${t.projectName ?? '?'} › ${baseName(spec.file ?? suite.file)} › ${spec.title}`;
        if (pool && !pool.some((p) => p.test(key))) continue;
        out.judged += 1;
        const errors = (t.results ?? []).flatMap((r) => r.errors ?? (r.error ? [r.error] : []));
        const other = errors.filter((e) => !isGenesisError(e.message));
        // A failed case with no recorded error at all is not provably genesis: treat as defective.
        if (errors.length > 0 && other.length === 0) {
          out.genesisOnly += 1;
        } else {
          const why = other.length ? other.map((e) => firstLine(e.message)).join(' | ') : 'no error recorded';
          out.defective.push({ key, why });
        }
      }
    }
    for (const s of suite.suites ?? []) walk(s);
  };
  for (const s of report.suites ?? []) walk(s);
  return out;
}

function selfTest() {
  const mk = (title, status, messages) => ({
    title,
    file: 'desktop/e2e/v3/bench.spec.ts',
    tests: [{ projectName: 'desktop', status, results: [{ errors: messages.map((message) => ({ message })) }] }],
  });
  const missing = "Error: A snapshot doesn't exist at /x/a.png, writing actual.";
  const audit = 'Error: emptyBoxes: <div> "text" holds text but is 0×198';
  const cases = [
    ['a pure missing-baseline case is genesis', [mk('@visual a', 'unexpected', [missing])], 1, 0],
    ['an audit failure next to a missing baseline is defective', [mk('@visual b', 'unexpected', [audit, missing])], 0, 1],
    ['an audit failure alone is defective', [mk('@visual c', 'unexpected', [audit])], 0, 1],
    ['a failed case with no error recorded is defective', [mk('@visual d', 'unexpected', [])], 0, 1],
    ['a flaky case is judged like a failed one', [mk('@visual e', 'flaky', [audit])], 0, 1],
    ['a passing case is ignored', [mk('@visual f', 'expected', [])], 0, 0],
    ['ansi colour codes do not hide the genesis message', [mk('@visual g', 'unexpected', [`${ESC}[31m${missing}${ESC}[39m`])], 1, 0],
  ];
  let failed = 0;
  for (const [name, specs, wantGenesis, wantDefective] of cases) {
    const got = classify({ suites: [{ specs }] });
    const ok = got.genesisOnly === wantGenesis && got.defective.length === wantDefective;
    if (!ok) failed += 1;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
  }
  // Pool filter: a defective case outside the pool is not this tool's business; inside it is.
  const pool = loadPool('# comment\n^desktop › bench\\.spec\\.ts › .*@visual\n');
  const remote = {
    title: 'remote look',
    file: 'remote/e2e/bench.visual.spec.ts',
    tests: [{ projectName: 'remote', status: 'unexpected', results: [{ errors: [{ message: audit }] }] }],
  };
  const outside = classify({ suites: [{ specs: [remote] }] }, pool);
  const inside = classify({ suites: [{ specs: [mk('@visual h', 'unexpected', [audit])] }] }, pool);
  for (const [name, ok] of [
    ['a failed case outside the pool is not judged', outside.unexpected === 1 && outside.judged === 0 && outside.defective.length === 0],
    ['a defective case inside the pool is caught', inside.judged === 1 && inside.defective.length === 1],
  ]) {
    if (!ok) failed += 1;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
  }
  process.exit(failed ? 1 : 0);
}

const [mode, file, poolFile] = process.argv.slice(2);
if (mode === '--self-test') {
  selfTest();
} else if (mode === 'check' && file) {
  let report;
  try {
    report = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    die(`cannot read ${file}: ${e.message}`);
  }
  let pool = null;
  if (poolFile) {
    try {
      pool = loadPool(readFileSync(poolFile, 'utf8'));
    } catch (e) {
      die(`cannot read ${poolFile}: ${e.message}`);
    }
    if (pool.length === 0) die(`${poolFile} holds no pattern`);
  }
  const res = classify(report, pool);
  console.log(
    `unexpected=${res.unexpected} judged=${res.judged} genesis_only=${res.genesisOnly} defective=${res.defective.length}`,
  );
  for (const d of res.defective) console.log(`DEFECTIVE ${d.key} :: ${d.why}`);
  process.exit(res.defective.length ? 1 : 0);
} else {
  die('usage: pw-genesis.mjs check <playwright-report.json> [pool.txt] | --self-test');
}
