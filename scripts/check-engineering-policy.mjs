#!/usr/bin/env node
// scripts/check-engineering-policy.mjs — validate the Warsha engineering operating policy.
//
// Usage:
//   node scripts/check-engineering-policy.mjs              check the repository this file lives in
//   node scripts/check-engineering-policy.mjs --root <dir> check another tree (used by the self-test)
//   node scripts/check-engineering-policy.mjs --self-test  plant one failure per check in a temp
//                                          fixture, assert every check fires, and assert a clean
//                                          fixture is reported clean
//
// Output contract (see ENGINEERING_POLICY.md §Enforcement):
//   `E<NN>: <what is wrong>` on stdout, one line per failure, exit 1;
//   `policy: 8 checks, 0 failures` on stdout and exit 0 otherwise.
//
// The checks (ids are stable; the self-test names them below):
//   E1 ENGINEERING_POLICY.md exists and is not empty
//   E2 required `##` sections (lifecycle, roles, state and checkpoint, evidence, failure, security, provenance)
//   E3 required lifecycle phase headings (`###` intake, plan, implementation, review, verification, repair, acceptance)
//   E4 required policy terms (worktree isolation, gates, repair bound, roles, state schema, evidence, secrets)
//   E5 provenance: the four inspiration-only repo URLs and the no-copy statement
//   E6 AGENTS.md references ENGINEERING_POLICY.md
//   E7 AGENTS.md requires running this validator
//   E8 package.json defines scripts.policy invoking this validator
//
// Dependency-free on purpose: like check-arch.mjs, this may run before `pnpm install`.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const POLICY_FILE = 'ENGINEERING_POLICY.md';

const CHECK_IDS = [
  ['E1', 'policy-file'],
  ['E2', 'lifecycle-sections'],
  ['E3', 'lifecycle-phases'],
  ['E4', 'required-terms'],
  ['E5', 'provenance'],
  ['E6', 'agents-reference'],
  ['E7', 'agents-validator-command'],
  ['E8', 'package-script'],
];

// Required as `##` section headings (matched case-insensitively against the heading text).
const REQUIRED_SECTIONS = [
  'lifecycle',
  'roles',
  'state and checkpoint',
  'evidence',
  'failure',
  'security',
  'provenance',
];

// Required as `###` lifecycle phase headings, in the policy's own order.
const REQUIRED_PHASES = [
  'intake',
  'plan',
  'implementation',
  'review',
  'verification',
  'repair',
  'acceptance',
];

// Required anywhere in the policy text (whitespace-flattened, case-insensitive substring).
// Each one pins a substantive rule of the lifecycle, not just a word:
//   git worktree + isolated   -> isolated worktree requirement for worker execution
//   acceptance_gates + machine-readable -> machine-readable acceptance gates
//   max_repair_iterations + never loosens tests -> bounded repair loops that never loosen tests
//   implementer/reviewer/verifier -> separate implementation/review/verification roles
//   state.json + checkpoint + warsha-run/v1 + resumable -> state/checkpoint schema, evidence trail
//   bridge-io/policy + redact -> evidence directory + secret-safe artifacts
//   keychain + mock provider + agents can never approve gates -> security boundaries
const REQUIRED_TERMS = [
  'git worktree',
  'isolated',
  'acceptance_gates',
  'max_repair_iterations',
  'never loosens tests',
  'machine-readable',
  'in-scope',
  'out-of-scope',
  'implementer',
  'reviewer',
  'verifier',
  'state.json',
  'checkpoint',
  'warsha-run/v1',
  'resumable',
  'bridge-io/policy',
  'redact',
  'keychain',
  'mock provider',
  'agents can never approve gates',
];

// Provenance: four repos named as inspiration only, with URLs, and an explicit no-copy statement.
const REQUIRED_PROVENANCE = [
  'github.com/superplanehq/superplane',
  'github.com/open-inspect/background-agents',
  'github.com/agent-field/swe-af',
  'github.com/the-open-engine/zeroshot',
  'inspiration only',
  'no upstream content was copied',
];

const VALIDATOR_COMMAND = 'node scripts/check-engineering-policy.mjs';

function readIfExists(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function run(root) {
  const failures = [];
  const push = (id, message) => failures.push({ id, message });

  // ------------------------------------------------------------------------- E1..E5: the policy doc
  const policyText = readIfExists(path.join(root, POLICY_FILE));
  if (policyText === null || policyText.trim() === '') {
    push('E1', `${POLICY_FILE}: missing or empty`);
  } else {
    const flat = policyText.replace(/\s+/g, ' ').toLowerCase();
    const lines = policyText.split('\n').map((line) => line.trim());
    const sectionHeadings = lines.filter((line) => /^##\s+/.test(line)).map((l) => l.toLowerCase());
    const phaseHeadings = lines.filter((line) => /^###\s+/.test(line)).map((l) => l.toLowerCase());

    for (const section of REQUIRED_SECTIONS) {
      if (!sectionHeadings.some((heading) => heading.includes(section))) {
        push('E2', `${POLICY_FILE}: missing required section heading for '${section}'`);
      }
    }

    for (const phase of REQUIRED_PHASES) {
      if (!phaseHeadings.some((heading) => heading.includes(phase))) {
        push('E3', `${POLICY_FILE}: missing lifecycle phase heading for '${phase}'`);
      }
    }

    for (const term of REQUIRED_TERMS) {
      if (!flat.includes(term.toLowerCase())) {
        push('E4', `${POLICY_FILE}: missing required term '${term}'`);
      }
    }

    for (const reference of REQUIRED_PROVENANCE) {
      if (!flat.includes(reference.toLowerCase())) {
        push('E5', `${POLICY_FILE}: missing provenance reference '${reference}'`);
      }
    }
  }

  // ---------------------------------------------------------------------------- E6, E7: AGENTS.md
  const agents = readIfExists(path.join(root, 'AGENTS.md'));
  if (agents === null) {
    push('E6', 'AGENTS.md: missing');
    push('E7', 'AGENTS.md: missing');
  } else {
    if (!agents.includes(POLICY_FILE)) {
      push('E6', 'AGENTS.md: does not reference ENGINEERING_POLICY.md');
    }
    if (!agents.includes(VALIDATOR_COMMAND)) {
      push('E7', `AGENTS.md: does not require running \`${VALIDATOR_COMMAND}\``);
    }
  }

  // --------------------------------------------------------------------------- E8: package.json
  const pkgPath = path.join(root, 'package.json');
  const pkgText = readIfExists(pkgPath);
  let pkg = null;
  if (pkgText === null) {
    push('E8', 'package.json: missing');
  } else {
    try {
      pkg = JSON.parse(pkgText);
    } catch {
      push('E8', 'package.json: invalid JSON');
    }
    if (pkg !== null) {
      const policyScript = pkg.scripts && pkg.scripts.policy;
      if (typeof policyScript !== 'string' || !policyScript.includes(VALIDATOR_COMMAND)) {
        push('E8', `package.json: scripts.policy must invoke \`${VALIDATOR_COMMAND}\``);
      }
    }
  }

  return failures;
}

// ----------------------------------------------------------------------------------------- self-test

function cleanPolicyFixture() {
  const sections = REQUIRED_SECTIONS.map((s, i) => `## ${i + 1}. ${s}`).join('\n');
  const phases = REQUIRED_PHASES.map((p, i) => `### ${i + 1}. ${p} phase`).join('\n');
  const terms = REQUIRED_TERMS.join(' · ');
  const provenance = REQUIRED_PROVENANCE.map((r) => `- ${r}`).join('\n');
  return [
    '# ENGINEERING_POLICY.md — fixture',
    '',
    sections,
    '',
    phases,
    '',
    `Terms: ${terms}`,
    '',
    'Provenance: ' + provenance,
    '',
  ].join('\n');
}

function cleanFixture() {
  return {
    [POLICY_FILE]: cleanPolicyFixture(),
    'AGENTS.md': [
      '# AGENTS.md — fixture',
      `- Read ${POLICY_FILE} first.`,
      `- Policy changes run \`${VALIDATOR_COMMAND}\`.`,
      '',
    ].join('\n'),
    'package.json': JSON.stringify(
      { name: 'warsha-fixture', scripts: { policy: VALIDATOR_COMMAND } },
      null,
      2
    ),
  };
}

function writeTree(base, files) {
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(base, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  }
}

// One surgical mutation per check id; everything else in the fixture stays clean, so each mutant
// must fail with exactly that id.
const MUTATIONS = [
  ['E1', (files) => delete files[POLICY_FILE]],
  ['E2', (files) => (files[POLICY_FILE] = files[POLICY_FILE].replace(/^## \d+\. roles$/m, ''))],
  ['E3', (files) => (files[POLICY_FILE] = files[POLICY_FILE].replace(/^### \d+\. repair phase$/m, ''))],
  ['E4', (files) => (files[POLICY_FILE] = files[POLICY_FILE].replaceAll('max_repair_iterations', 'x'))],
  ['E5', (files) => (files[POLICY_FILE] = files[POLICY_FILE].replace('github.com/the-open-engine/zeroshot', 'example.invalid'))],
  ['E6', (files) => (files['AGENTS.md'] = files['AGENTS.md'].replaceAll(POLICY_FILE, 'STYLE.md'))],
  ['E7', (files) => (files['AGENTS.md'] = files['AGENTS.md'].replaceAll(VALIDATOR_COMMAND, 'true'))],
  [
    'E8',
    (files) => {
      const pkg = JSON.parse(files['package.json']);
      delete pkg.scripts.policy;
      files['package.json'] = JSON.stringify(pkg, null, 2);
    },
  ],
];

function selfTest() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'warsha-policy-selftest-'));
  const names = Object.fromEntries(CHECK_IDS);
  let failed = false;
  try {
    for (const [expectedId, mutate] of MUTATIONS) {
      const dir = path.join(base, `mutant-${expectedId}`);
      const files = cleanFixture();
      mutate(files);
      writeTree(dir, files);
      const found = run(dir);
      const ids = new Set(found.map((f) => f.id));
      if (ids.size === 1 && ids.has(expectedId)) {
        console.log(`self-test ${expectedId} ${names[expectedId]}: detected — ${found[0].message}`);
      } else {
        failed = true;
        console.log(
          `self-test ${expectedId} ${names[expectedId]}: FAILED — expected only ${expectedId}, saw [${[...ids].join(', ') || 'nothing'}]`
        );
      }
    }

    const cleanDir = path.join(base, 'clean');
    writeTree(cleanDir, cleanFixture());
    const cleanFailures = run(cleanDir);
    if (cleanFailures.length === 0) {
      console.log('self-test clean fixture: 0 failures');
    } else {
      failed = true;
      for (const f of cleanFailures) {
        console.log(`self-test clean fixture: FAILED — false positive ${f.id}: ${f.message}`);
      }
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }

  if (failed) {
    console.log('policy self-test: FAILED');
    return 1;
  }
  console.log(`policy self-test: ${CHECK_IDS.length} checks fire, clean fixture is clean`);
  return 0;
}

function main(argv) {
  if (argv.includes('--self-test')) return selfTest();

  const rootFlag = argv.indexOf('--root');
  const root =
    rootFlag >= 0 && argv[rootFlag + 1]
      ? path.resolve(argv[rootFlag + 1])
      : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  const failures = run(root);
  for (const f of failures) {
    process.stdout.write(`${f.id}: ${f.message}\n`);
  }
  if (failures.length > 0) {
    process.stdout.write(`policy: ${CHECK_IDS.length} checks, ${failures.length} failure(s)\n`);
    return 1;
  }
  process.stdout.write(`policy: ${CHECK_IDS.length} checks, 0 failures\n`);
  return 0;
}

process.exit(main(process.argv.slice(2)));
