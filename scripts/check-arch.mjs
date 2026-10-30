#!/usr/bin/env node
// scripts/check-arch.mjs — enforce the architecture rules in docs/ARCH_RULES.md.
//
// Usage:
//   node scripts/check-arch.mjs              check the repository this file lives in
//   node scripts/check-arch.mjs --root <dir> check another tree (used by the self-test)
//   node scripts/check-arch.mjs --self-test  plant one violation per rule in a temp fixture,
//                                            assert every rule fires, and assert a clean tree
//                                            is reported clean
//
// Output contract (see docs/ARCH_RULES.md):
//   `<RULE-ID>: <file>:<line> <offence>` on stdout, one line per violation, exit 1;
//   `arch: 5 rules, 0 violations` on stdout and exit 0 otherwise.
//
// Dependency-free on purpose: this runs before `pnpm install` in some environments, so it must not
// need anything from node_modules.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RULE_IDS = ['R1', 'R2', 'R3', 'R4', 'R5'];

// Tier map for R3. Lower tier must never depend on a strictly higher tier, so `warsha-backends`
// sits beside `warsha-pipeline` (it implements pipeline traits) and R2 forbids the reverse edge.
// Rationale for the deviation from the PLAN.md ring sketch: docs/ARCH_RULES.md R3 and DECISIONS.md.
const CRATE_TIERS = new Map([
  ['warsha-core', 0],
  ['warsha-store', 1],
  ['warsha-providers', 2],
  ['warsha-git', 2],
  ['warsha-remote', 2],
  ['warsha-pipeline', 3],
  ['warsha-backends', 3],
  ['warshad', 4],
  ['warsha-cli', 4],
  ['warsha-relay', 4],
]);

const PIPELINE_FORBIDDEN = new Set(['warshad', 'warsha-cli', 'warsha-relay', 'warsha-backends']);

const UI_DIRS = ['apps/desktop/src', 'apps/remote/src'];
const UI_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

const toPosix = (p) => p.split(path.sep).join('/');

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

const violation = (rule, file, line, offence) => ({ rule, file: toPosix(file), line, offence });

function readIfExists(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function listCrateDirs(root) {
  const cratesDir = path.join(root, 'crates');
  if (!fs.existsSync(cratesDir)) return [];
  return fs
    .readdirSync(cratesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(cratesDir, name, 'Cargo.toml')))
    .sort();
}

function listFilesUnder(dir, extensions) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', 'dist', 'build', 'target', 'book'].includes(entry.name)) continue;
        stack.push(full);
      } else if (extensions.has(path.extname(entry.name))) {
        out.push(full);
      }
    }
  }
  return out.sort();
}

/**
 * Split a Cargo.toml into dependency entries.
 * Returns [{ name, line, pathLine }] for every dependency in a dependency table, covering
 * `[dependencies]`, `[dev-dependencies]`, `[build-dependencies]`, the per-target forms
 * (`[target.'cfg(windows)'.dependencies]`) and the sub-table form (`[dependencies.warsha-core]`,
 * whose `path = …` is a later line). `pathLine` is the 1-based line of the `path = …` key, or null
 * when the dependency has no path key (a registry or git dependency).
 */
function parseCargoDependencies(text) {
  const entries = [];
  const lines = text.split('\n');
  const depTable = /(?:^|\.)(?:dependencies|dev-dependencies|build-dependencies)$/;
  const depSubTable = /(?:^|\.)(?:dependencies|dev-dependencies|build-dependencies)\.([A-Za-z0-9_-]+)$/;

  let inDepTable = false;
  let subTable = null;

  for (let i = 0; i < lines.length; i += 1) {
    const header = /^\s*\[([^\]]+)\]/.exec(lines[i]);
    if (header) {
      const section = header[1].trim();
      inDepTable = depTable.test(section);
      const sub = depSubTable.exec(section);
      subTable = sub ? { name: sub[1], line: i + 1, pathLine: null } : null;
      if (subTable) entries.push(subTable);
      continue;
    }
    if (!inDepTable && subTable === null) continue;

    if (subTable !== null) {
      if (subTable.pathLine === null && /^\s*path\s*=/.test(lines[i])) {
        subTable.pathLine = i + 1;
      }
      continue;
    }

    const row = /^\s*([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(lines[i]);
    if (!row) continue;
    const [, name, value] = row;
    entries.push({ name, line: i + 1, pathLine: /\bpath\s*=/.test(value) ? i + 1 : null });
  }

  return entries;
}

/** Collect module visibility and `pub use` names from a crate's lib.rs. */
function parseLibExports(source) {
  const privateModules = new Set();
  const exported = new Set();
  const lines = source.split('\n');

  for (const line of lines) {
    const mod = /^\s*(pub\(crate\)|pub\(super\)|pub\(in [^)]*\))?\s*mod\s+([A-Za-z0-9_]+)\s*;/.exec(line);
    if (!mod) continue;
    const visibility = (mod[1] ?? '').trim();
    if (visibility === '') privateModules.add(mod[2]);
  }

  // `pub use foo::{A, B as C};`, `pub use foo::Bar;`, `pub use crate::m::{self, X};`
  const useBlocks = source.match(/^\s*pub\s+use\s+[^;]+;/gm) ?? [];
  for (const block of useBlocks) {
    const body = block.replace(/^\s*pub\s+use\s+/, '').replace(/;$/, '');
    const braces = /\{([\s\S]*)\}/.exec(body);
    if (braces) {
      for (const part of braces[1].split(',')) {
        const alias = /\bas\s+([A-Za-z0-9_]+)\s*$/.exec(part.trim());
        const name = alias ? alias[1] : part.trim().split('::').pop()?.trim();
        if (name && name !== 'self' && /^[A-Za-z0-9_]+$/.test(name)) exported.add(name);
      }
    }
    const leaf = body.split('::').pop()?.trim();
    if (leaf && /^[A-Za-z0-9_]+$/.test(leaf)) exported.add(leaf);
  }

  return { privateModules, exported };
}

function run(root) {
  const violations = [];
  const crateNames = listCrateDirs(root);
  const libExports = new Map();

  for (const crate of crateNames) {
    const lib = readIfExists(path.join(root, 'crates', crate, 'src', 'lib.rs'));
    if (lib) libExports.set(crate, parseLibExports(lib));
  }

  const cleartext = (text) =>
    text
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));

  // ---------------------------------------------------------------- R1, R2, R3: Cargo.toml edges
  for (const crate of crateNames) {
    const manifest = `crates/${crate}/Cargo.toml`;
    const text = readIfExists(path.join(root, manifest));
    if (text === null) continue;
    const deps = parseCargoDependencies(text);
    const fromTier = CRATE_TIERS.get(crate);
    if (fromTier === undefined) {
      violations.push(violation('R3', manifest, 1, `crate ${crate} is not in the ring order`));
      continue;
    }

    for (const dep of deps) {
      if (crate === 'warsha-core' && dep.pathLine !== null) {
        violations.push(violation('R1', manifest, dep.pathLine, `path dependency ${dep.name}`));
      }

      if (crate === 'warsha-pipeline' && PIPELINE_FORBIDDEN.has(dep.name)) {
        violations.push(violation('R2', manifest, dep.line, `dependency ${dep.name}`));
        continue;
      }

      // Only in-repo edges participate in the ring: a path dependency, or a name that belongs to
      // the workspace. A registry dependency called `serde` is not part of the layering.
      const looksInRepo = dep.pathLine !== null || CRATE_TIERS.has(dep.name) || dep.name === 'warshad';
      if (!looksInRepo) continue;

      const toTier = CRATE_TIERS.get(dep.name);
      if (toTier === undefined) {
        violations.push(
          violation('R3', manifest, dep.line, `dependency ${dep.name} (not in the ring order)`)
        );
        continue;
      }
      if (toTier > fromTier) {
        violations.push(
          violation(
            'R3',
            manifest,
            dep.line,
            `dependency ${dep.name} (tier ${toTier} is above ${crate} tier ${fromTier})`
          )
        );
      }
    }
  }

  // ---------------------------------------------------------------------------------- R4: modules
  const rustFiles = [];
  for (const crate of crateNames) {
    for (const file of listFilesUnder(path.join(root, 'crates', crate, 'src'), new Set(['.rs']))) {
      rustFiles.push({ crate, file });
    }
  }

  for (const { crate, file } of rustFiles) {
    const source = readIfExists(file);
    if (source === null) continue;
    const scanned = cleartext(source);
    const rel = path.relative(root, file);

    const pathRe = /\bwarsha_([a-z0-9_]+)::([A-Za-z0-9_]+)/g;
    let match;
    while ((match = pathRe.exec(scanned)) !== null) {
      const target = `warsha-${match[1].replace(/_/g, '-')}`;
      const segment = match[2];
      // A path inside the crate's own code (`crate::mod`, or `warsha_x::` naming itself) is not a
      // reach into another crate's privacy.
      if (target === crate) continue;
      const exports = libExports.get(target);
      if (!exports) continue;
      if (!exports.privateModules.has(segment)) continue;
      if (exports.exported.has(segment)) continue;
      violations.push(
        violation(
          'R4',
          rel,
          lineOf(scanned, match.index),
          `path warsha_${match[1]}::${segment} (private module)`
        )
      );
    }
  }

  // ------------------------------------------------------------------------------- R5: UI through client
  for (const dir of UI_DIRS) {
    for (const file of listFilesUnder(path.join(root, dir), UI_EXTENSIONS)) {
      const source = readIfExists(file);
      if (source === null) continue;
      const scanned = cleartext(source);
      const rel = path.relative(root, file);

      const importRe = /(?:^|[\s;])(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
      let match;
      while ((match = importRe.exec(scanned)) !== null) {
        const specifier = match[1] ?? match[2];
        if (!specifier) continue;
        if (/(^|\/)crates\//.test(specifier)) {
          violations.push(
            violation(
              'R5',
              rel,
              lineOf(scanned, match.index),
              `import ${specifier} (crates are not importable from the UI)`
            )
          );
        }
      }

      for (const [pattern, label] of [
        [/\bfetch\s*\(/g, 'fetch('],
        [/\bnew\s+WebSocket\s*\(/g, 'new WebSocket('],
      ]) {
        let hit;
        while ((hit = pattern.exec(scanned)) !== null) {
          violations.push(
            violation('R5', rel, lineOf(scanned, hit.index), `${label} (call daemon through @warsha/client)`)
          );
        }
      }
    }
  }

  violations.sort(
    (a, b) => a.rule.localeCompare(b.rule) || a.file.localeCompare(b.file) || a.line - b.line
  );
  return violations;
}

// ----------------------------------------------------------------------------------------- self-test

function writeTree(base, files) {
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(base, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  }
}

function cleanFixture() {
  const cargo = (name, deps) =>
    [
      '[package]',
      `name = "${name}"`,
      'version = "0.1.0"',
      '',
      '[dependencies]',
      ...deps,
      '',
    ].join('\n');
  const path_dep = (name) => `${name} = { path = "../${name}" }`;

  return {
    'Cargo.toml': '[workspace]\nmembers = []\n',
    'crates/warsha-core/Cargo.toml': cargo('warsha-core', ['serde = "1"']),
    'crates/warsha-core/src/lib.rs': 'pub struct Project;\n',
    'crates/warsha-store/Cargo.toml': cargo('warsha-store', [path_dep('warsha-core')]),
    'crates/warsha-store/src/lib.rs': 'use warsha_core::Project;\npub struct Store;\n',
    'crates/warsha-providers/Cargo.toml': cargo('warsha-providers', [path_dep('warsha-core')]),
    'crates/warsha-providers/src/lib.rs': 'use warsha_core::Project;\npub struct Router;\n',
    'crates/warsha-git/Cargo.toml': cargo('warsha-git', [path_dep('warsha-core')]),
    'crates/warsha-git/src/lib.rs': 'pub struct Repo;\n',
    'crates/warsha-remote/Cargo.toml': cargo('warsha-remote', [path_dep('warsha-core')]),
    'crates/warsha-remote/src/lib.rs': 'pub struct DeviceIdentity;\n',
    'crates/warsha-pipeline/Cargo.toml': cargo('warsha-pipeline', [
      path_dep('warsha-core'),
      path_dep('warsha-store'),
      path_dep('warsha-providers'),
    ]),
    'crates/warsha-pipeline/src/lib.rs': [
      'mod handoff;',
      'pub use crate::handoff::{HandoffState};',
      'pub struct Engine;',
      '',
    ].join('\n'),
    'crates/warsha-pipeline/src/handoff.rs': 'pub struct HandoffState;\n',
    'crates/warsha-backends/Cargo.toml': cargo('warsha-backends', [
      path_dep('warsha-core'),
      path_dep('warsha-pipeline'),
    ]),
    'crates/warsha-backends/src/lib.rs': 'use warsha_pipeline::Engine;\n',
    'crates/warshad/Cargo.toml': cargo('warshad', [
      path_dep('warsha-core'),
      path_dep('warsha-store'),
      path_dep('warsha-providers'),
      path_dep('warsha-pipeline'),
      path_dep('warsha-backends'),
      path_dep('warsha-git'),
      path_dep('warsha-remote'),
    ]),
    'crates/warshad/src/lib.rs': 'use warsha_pipeline::Engine;\n',
    'crates/warsha-cli/Cargo.toml': cargo('warsha-cli', [path_dep('warsha-core')]),
    'crates/warsha-cli/src/lib.rs': 'use warsha_core::Project;\n',
    'crates/warsha-relay/Cargo.toml': cargo('warsha-relay', [
      path_dep('warsha-core'),
      path_dep('warsha-remote'),
    ]),
    'crates/warsha-relay/src/lib.rs': 'use warsha_remote::DeviceIdentity;\n',
    'packages/client/src/index.ts': 'export async function rpc() {\n  return await fetch("/rpc");\n}\n',
    'apps/desktop/src/App.tsx': [
      "import { t } from '@warsha/i18n';",
      "import { rpc } from '@warsha/client';",
      '',
      'export function App() {',
      '  // fetch( in a comment is not a call',
      '  return <p>{t("app.name")}</p>;',
      '}',
      '',
    ].join('\n'),
  };
}

function violatingFixture() {
  const files = cleanFixture();

  // R1: core gains a path dependency.
  files['crates/warsha-core/Cargo.toml'] = [
    '[package]',
    'name = "warsha-core"',
    'version = "0.1.0"',
    '',
    '[dependencies]',
    'warsha-store = { path = "../warsha-store" }',
    '',
  ].join('\n');

  // R2: the pipeline depends on the daemon.
  files['crates/warsha-pipeline/Cargo.toml'] = [
    '[package]',
    'name = "warsha-pipeline"',
    'version = "0.1.0"',
    '',
    '[dependencies]',
    'warsha-core = { path = "../warsha-core" }',
    'warshad = { path = "../warshad" }',
    '',
  ].join('\n');

  // R3: the store depends on the pipeline (store tier 1, pipeline tier 3).
  files['crates/warsha-store/Cargo.toml'] = [
    '[package]',
    'name = "warsha-store"',
    'version = "0.1.0"',
    '',
    '[dependencies]',
    'warsha-core = { path = "../warsha-core" }',
    'warsha-pipeline = { path = "../warsha-pipeline" }',
    '',
  ].join('\n');

  // R4: warshad reaches into a private pipeline module.
  files['crates/warshad/src/lib.rs'] = [
    'use warsha_pipeline::Engine;',
    'use warsha_pipeline::handoff::HandoffState;',
    '',
  ].join('\n');

  // R5: a screen imports a crate, calls fetch( and opens a socket.
  files['apps/desktop/src/App.tsx'] = [
    "import { Engine } from '../../crates/warsha-pipeline/src/lib';",
    '',
    'export function App() {',
    '  fetch("/rpc", { method: "POST" });',
    '  const ws = new WebSocket("ws://127.0.0.1:8766/events");',
    '  return <p>{String(Boolean(Engine) && Boolean(ws))}</p>;',
    '}',
    '',
  ].join('\n');

  return files;
}

function selfTest() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'warsha-arch-selftest-'));
  const expectations = {
    R1: /path dependency warsha-store/,
    R2: /dependency warshad/,
    R3: /dependency warsha-pipeline \(tier 3 is above warsha-store tier 1\)/,
    R4: /path warsha_pipeline::handoff \(private module\)/,
    R5: /fetch\( \(call daemon through @warsha\/client\)/,
  };
  const r5Extras = [/new WebSocket\( \(call daemon through @warsha\/client\)/, /import \.\.\/\.\.\/crates\//];
  const names = {
    R1: 'core-is-leaf',
    R2: 'no-daemon-under-pipeline',
    R3: 'no-upward-edges',
    R4: 'no-private-module-reach',
    R5: 'ui-through-client',
  };

  let failed = false;
  try {
    const violatingRoot = path.join(base, 'violating');
    writeTree(violatingRoot, violatingFixture());
    const found = run(violatingRoot);

    for (const id of RULE_IDS) {
      const hits = found.filter((v) => v.rule === id);
      const matches = hits.filter((v) => expectations[id].test(v.offence));
      if (matches.length > 0) {
        console.log(`self-test ${id} ${names[id]}: detected ${matches[0].offence}`);
      } else {
        failed = true;
        console.log(
          `self-test ${id} ${names[id]}: FAILED — expected a ${id} violation, saw ${hits.length}`
        );
      }
    }

    const r5 = found.filter((v) => v.rule === 'R5');
    for (const extra of r5Extras) {
      if (!r5.some((v) => extra.test(v.offence))) {
        failed = true;
        console.log(`self-test R5 ui-through-client: FAILED — missing ${extra}`);
      }
    }
    if (!r5.some((v) => v.offence.startsWith('fetch(')) || !r5.some((v) => v.offence.startsWith('new WebSocket('))) {
      failed = true;
      console.log('self-test R5 ui-through-client: FAILED — expected both fetch( and new WebSocket(');
    }

    // Message format: every line must be `<RULE-ID>: <file>:<line> <offence>` with a relative path.
    for (const v of found) {
      const rendered = `${v.rule}: ${v.file}:${v.line} ${v.offence}`;
      const ok =
        new RegExp(`^R[1-5]: [^:\\n]+:\\d+ \\S`).test(rendered) && !path.isAbsolute(v.file);
      if (!ok) {
        failed = true;
        console.log(`self-test message format: FAILED — ${rendered}`);
      }
    }

    const cleanRoot = path.join(base, 'clean');
    writeTree(cleanRoot, cleanFixture());
    const cleanViolations = run(cleanRoot);
    for (const v of cleanViolations) {
      failed = true;
      console.log(`self-test clean fixture: FAILED — false positive ${v.rule}: ${v.file}:${v.line} ${v.offence}`);
    }
    if (cleanViolations.length === 0) {
      console.log('self-test clean fixture: 0 violations');
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }

  if (failed) {
    console.log('arch self-test: FAILED');
    return 1;
  }
  console.log('arch self-test: 5 rules fire, clean fixture is clean');
  return 0;
}

function main(argv) {
  if (argv.includes('--self-test')) return selfTest();

  const rootFlag = argv.indexOf('--root');
  const root =
    rootFlag >= 0 && argv[rootFlag + 1]
      ? path.resolve(argv[rootFlag + 1])
      : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  const violations = run(root);
  for (const v of violations) {
    process.stdout.write(`${v.rule}: ${v.file}:${v.line} ${v.offence}\n`);
  }
  if (violations.length > 0) {
    process.stdout.write(`arch: ${RULE_IDS.length} rules, ${violations.length} violation(s)\n`);
    return 1;
  }
  process.stdout.write(`arch: ${RULE_IDS.length} rules, 0 violations\n`);
  return 0;
}

process.exit(main(process.argv.slice(2)));
