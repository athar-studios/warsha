#!/usr/bin/env node
// scripts/check-versions.mjs — validate and synchronize Warsha component versions.
//
// Usage:
//   node scripts/check-versions.mjs [dir]                 check that all component versions match
//   node scripts/check-versions.mjs [dir] --expect <v>   check that all component versions equal <v>
//   node scripts/check-versions.mjs [dir] --set <v>      update all component versions to <v>
//   node scripts/check-versions.mjs --self-test           verify checker and updater on temp fixtures
//
// Managed fields:
//   - Cargo.toml [workspace.package] version
//   - apps/desktop/src-tauri/Cargo.toml [package] version
//   - apps/desktop/src-tauri/tauri.conf.json version
//   - package.json (root) version
//   - apps/desktop/package.json version
//   - apps/remote/package.json version
//   - packages/ui/package.json version
//   - packages/client/package.json version
//   - packages/i18n/package.json version
//   - packages/crypto/package.json version
//   - apps/mobile/android/app/build.gradle versionName and versionCode (major*10000 + minor*100 + patch)
//   - docker/compose.yml warshad image tag
//   - Cargo.lock workspace member entries (offline)

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKSPACE_CRATES = [
  'warsha-backends',
  'warsha-cli',
  'warsha-core',
  'warsha-desktop',
  'warsha-git',
  'warsha-pipeline',
  'warsha-providers',
  'warsha-relay',
  'warsha-remote',
  'warsha-store',
  'warshad',
];

const JSON_PACKAGES = [
  'package.json',
  'apps/desktop/package.json',
  'apps/remote/package.json',
  'packages/ui/package.json',
  'packages/client/package.json',
  'packages/i18n/package.json',
  'packages/crypto/package.json',
];

function computeVersionCode(version) {
  const parts = String(version).split('.').map(Number);
  if (parts.length < 3 || parts.some(isNaN)) {
    throw new Error(`Invalid semver for versionCode: ${version}`);
  }
  const [major, minor, patch] = parts;
  return String(major * 10000 + minor * 100 + patch);
}

function readVersions(rootDir) {
  const readFile = (rel) => {
    const full = join(rootDir, rel);
    return existsSync(full) ? readFileSync(full, 'utf8') : null;
  };

  const rows = [];
  const add = (label, file, value) => rows.push({ label, file, value: value ?? 'MISSING' });

  // 1. Cargo.toml [workspace.package]
  const rootCargo = readFile('Cargo.toml');
  const rootCargoVer = rootCargo?.match(/\[workspace\.package\][^[]*?\nversion\s*=\s*"([^"]+)"/s)?.[1];
  add('Cargo.toml [workspace.package]', 'Cargo.toml', rootCargoVer);

  // 2. apps/desktop/src-tauri/Cargo.toml
  const desktopCargo = readFile('apps/desktop/src-tauri/Cargo.toml');
  const desktopCargoVer = desktopCargo?.match(/\[package\][^[]*?\nversion\s*=\s*"([^"]+)"/s)?.[1];
  add('apps/desktop/src-tauri/Cargo.toml', 'apps/desktop/src-tauri/Cargo.toml', desktopCargoVer);

  // 3. apps/desktop/src-tauri/tauri.conf.json
  const tauriConf = readFile('apps/desktop/src-tauri/tauri.conf.json');
  let tauriVer = null;
  if (tauriConf) {
    try {
      tauriVer = JSON.parse(tauriConf).version;
    } catch {
      tauriVer = 'PARSE_ERROR';
    }
  }
  add('apps/desktop/src-tauri/tauri.conf.json', 'apps/desktop/src-tauri/tauri.conf.json', tauriVer);

  // 4-10. JSON packages
  for (const p of JSON_PACKAGES) {
    const content = readFile(p);
    let ver = null;
    if (content) {
      try {
        ver = JSON.parse(content).version;
      } catch {
        ver = 'PARSE_ERROR';
      }
    }
    add(p, p, ver);
  }

  // 11. apps/mobile/android/app/build.gradle
  const gradle = readFile('apps/mobile/android/app/build.gradle');
  const versionName = gradle?.match(/versionName\s+["']([^"']+)["']/)?.[1];
  const versionCode = gradle?.match(/versionCode\s+(\d+)/)?.[1];
  add('apps/mobile versionName', 'apps/mobile/android/app/build.gradle', versionName);

  // 12. docker/compose.yml
  const compose = readFile('docker/compose.yml');
  const composeTag = compose?.match(/warsha\/warshad:([0-9][^\s"']*)/)?.[1];
  add('docker/compose.yml warshad tag', 'docker/compose.yml', composeTag);

  // 13. Cargo.lock workspace entries (offline check)
  const rootLock = readFile('Cargo.lock');
  let lockMismatch = false;
  let lockVer = null;
  if (rootLock) {
    for (const crate of WORKSPACE_CRATES) {
      const re = new RegExp(`\\[\\[package\\]\\]\\r?\\nname = "${crate}"\\r?\\nversion = "([^"]+)"`, 'g');
      const match = re.exec(rootLock);
      if (match) {
        if (lockVer === null) {
          lockVer = match[1];
        } else if (lockVer !== match[1]) {
          lockMismatch = true;
        }
      }
    }
  }
  add('Cargo.lock workspace crates', 'Cargo.lock', lockMismatch ? 'MISMATCH' : lockVer);

  return { rows, versionCode };
}

function setVersions(rootDir, newVersion) {
  const newCode = computeVersionCode(newVersion);
  const updateFile = (rel, updater) => {
    const full = join(rootDir, rel);
    if (!existsSync(full)) return;
    const oldContent = readFileSync(full, 'utf8');
    const newContent = updater(oldContent);
    writeFileSync(full, newContent, 'utf8');
  };

  // 1. Cargo.toml
  updateFile('Cargo.toml', (content) => {
    return content.replace(
      /(\[workspace\.package\][^[]*?\nversion\s*=\s*")[^"]+(")/s,
      `$1${newVersion}$2`
    );
  });

  // 2. apps/desktop/src-tauri/Cargo.toml
  updateFile('apps/desktop/src-tauri/Cargo.toml', (content) => {
    return content.replace(
      /(\[package\][^[]*?\nversion\s*=\s*")[^"]+(")/s,
      `$1${newVersion}$2`
    );
  });

  // 3. apps/desktop/src-tauri/tauri.conf.json
  updateFile('apps/desktop/src-tauri/tauri.conf.json', (content) => {
    return content.replace(
      /("version"\s*:\s*")[^"]+(")/,
      `$1${newVersion}$2`
    );
  });

  // 4-10. JSON packages
  for (const p of JSON_PACKAGES) {
    updateFile(p, (content) => {
      return content.replace(
        /("version"\s*:\s*")[^"]+(")/,
        `$1${newVersion}$2`
      );
    });
  }

  // 11. apps/mobile/android/app/build.gradle
  updateFile('apps/mobile/android/app/build.gradle', (content) => {
    let updated = content.replace(
      /(versionName\s+["'])[^"']+(["'])/,
      `$1${newVersion}$2`
    );
    updated = updated.replace(
      /(versionCode\s+)\d+/,
      `$1${newCode}`
    );
    return updated;
  });

  // 12. docker/compose.yml
  updateFile('docker/compose.yml', (content) => {
    return content.replace(
      /(warsha\/warshad:)[0-9][^\s"']*/,
      `$1${newVersion}`
    );
  });

  // 13. Cargo.lock files (offline workspace entries)
  const lockFiles = ['Cargo.lock', 'apps/desktop/src-tauri/Cargo.lock'];
  for (const lockFile of lockFiles) {
    updateFile(lockFile, (content) => {
      let updated = content;
      for (const crate of WORKSPACE_CRATES) {
        const re = new RegExp(`(\\[\\[package\\]\\]\\r?\\nname = "${crate}"\\r?\\nversion = ")[^"]+(")`, 'g');
        updated = updated.replace(re, `$1${newVersion}$2`);
      }
      return updated;
    });
  }
}

function check(rootDir, expectedVersion, silent = false) {
  const { rows, versionCode } = readVersions(rootDir);
  const reference = rows[0]?.value;

  let wantCode = null;
  try {
    wantCode = reference && reference !== 'MISSING' ? computeVersionCode(reference) : null;
  } catch {
    wantCode = null;
  }

  const allRowsEqual = rows.every((r) => r.value === reference && r.value !== 'MISSING' && r.value !== 'MISMATCH');
  const codeMatches = versionCode === wantCode;
  const expectMatches = expectedVersion ? reference === expectedVersion : true;
  const ok = allRowsEqual && codeMatches && expectMatches;

  if (!silent) {
    const width = Math.max(...rows.map((r) => r.label.length), 'apps/mobile versionCode'.length);
    for (const r of rows) {
      const match = r.value === reference && (expectedVersion ? r.value === expectedVersion : true);
      const mark = match ? '' : '   <-- differs';
      process.stdout.write(`${r.label.padEnd(width)}  ${r.value}${mark}\n`);
    }
    const codeOk = versionCode === wantCode;
    process.stdout.write(
      `${'apps/mobile versionCode'.padEnd(width)}  ${versionCode ?? 'MISSING'} (want ${wantCode ?? '?'})${codeOk ? '' : '   <-- differs'}\n`
    );
    process.stdout.write(
      `versions: ${ok ? 'aligned' : 'NOT aligned'}${expectedVersion ? ` (expected ${expectedVersion})` : ''}\n`
    );
  }

  return ok;
}

function runSelfTest() {
  process.stdout.write('Running check-versions self-test...\n');
  const tmpRoot = join(tmpdir(), `warsha-versions-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpRoot, { recursive: true });

  try {
    const setupFixture = (ver) => {
      const code = computeVersionCode(ver);
      writeFileSync(join(tmpRoot, 'Cargo.toml'), `[workspace.package]\nversion = "${ver}"\n`, 'utf8');

      mkdirSync(join(tmpRoot, 'apps/desktop/src-tauri'), { recursive: true });
      writeFileSync(
        join(tmpRoot, 'apps/desktop/src-tauri/Cargo.toml'),
        `[package]\nname = "warsha-desktop"\nversion = "${ver}"\n`,
        'utf8'
      );
      writeFileSync(
        join(tmpRoot, 'apps/desktop/src-tauri/tauri.conf.json'),
        JSON.stringify({ version: ver }, null, 2),
        'utf8'
      );

      writeFileSync(join(tmpRoot, 'package.json'), JSON.stringify({ name: 'root', version: ver }, null, 2), 'utf8');
      writeFileSync(
        join(tmpRoot, 'apps/desktop/package.json'),
        JSON.stringify({ name: 'desktop', version: ver }, null, 2),
        'utf8'
      );

      mkdirSync(join(tmpRoot, 'apps/remote'), { recursive: true });
      writeFileSync(
        join(tmpRoot, 'apps/remote/package.json'),
        JSON.stringify({ name: 'remote', version: ver }, null, 2),
        'utf8'
      );

      for (const pkg of ['ui', 'client', 'i18n', 'crypto']) {
        mkdirSync(join(tmpRoot, `packages/${pkg}`), { recursive: true });
        writeFileSync(
          join(tmpRoot, `packages/${pkg}/package.json`),
          JSON.stringify({ name: `@warsha/${pkg}`, version: ver }, null, 2),
          'utf8'
        );
      }

      mkdirSync(join(tmpRoot, 'apps/mobile/android/app'), { recursive: true });
      writeFileSync(
        join(tmpRoot, 'apps/mobile/android/app/build.gradle'),
        `android {\n  defaultConfig {\n    versionCode ${code}\n    versionName "${ver}"\n  }\n}\n`,
        'utf8'
      );

      mkdirSync(join(tmpRoot, 'docker'), { recursive: true });
      writeFileSync(
        join(tmpRoot, 'docker/compose.yml'),
        `services:\n  warshad:\n    image: warsha/warshad:${ver}\n`,
        'utf8'
      );

      let lock = '# generated lockfile\n';
      for (const crate of WORKSPACE_CRATES) {
        lock += `[[package]]\nname = "${crate}"\nversion = "${ver}"\n\n`;
      }
      writeFileSync(join(tmpRoot, 'Cargo.lock'), lock, 'utf8');
    };

    // Test 1: aligned fixture with 0.2.1
    setupFixture('0.2.1');
    if (!check(tmpRoot, null, true)) {
      throw new Error('Self-test assertion failed: expected aligned 0.2.1 fixture to pass check');
    }
    if (!check(tmpRoot, '0.2.1', true)) {
      throw new Error('Self-test assertion failed: expected --expect 0.2.1 to pass on 0.2.1 fixture');
    }
    if (check(tmpRoot, '0.3.0', true)) {
      throw new Error('Self-test assertion failed: expected --expect 0.3.0 to fail on 0.2.1 fixture');
    }

    // Test 2: mismatch detection
    writeFileSync(
      join(tmpRoot, 'apps/remote/package.json'),
      JSON.stringify({ name: 'remote', version: '0.1.0' }, null, 2),
      'utf8'
    );
    if (check(tmpRoot, null, true)) {
      throw new Error('Self-test assertion failed: expected differing file to fail check');
    }

    // Test 3: setVersions updates all files
    setVersions(tmpRoot, '0.3.2');
    if (!check(tmpRoot, '0.3.2', true)) {
      throw new Error('Self-test assertion failed: expected setVersions(0.3.2) to bring all files to 0.3.2');
    }

    process.stdout.write('check-versions self-test: 4 assertions, 0 failures\n');
  } finally {
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // ignore temp cleanup error
    }
  }
}

function main() {
  const argv = process.argv.slice(2);

  if (argv.includes('--self-test')) {
    runSelfTest();
    process.exit(0);
  }

  const expectIdx = argv.indexOf('--expect');
  const expected = expectIdx >= 0 ? argv[expectIdx + 1] : null;

  const setIdx = argv.indexOf('--set');
  const setTo = setIdx >= 0 ? argv[setIdx + 1] : null;

  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const repoDefault = join(scriptDir, '..');

  const dirArg = argv.find(
    (a, i) =>
      !a.startsWith('--') &&
      i !== expectIdx + 1 &&
      i !== setIdx + 1
  );
  const rootDir = dirArg ?? repoDefault;

  if (setTo) {
    process.stdout.write(`Updating versions in ${rootDir} to ${setTo}...\n`);
    setVersions(rootDir, setTo);
    const ok = check(rootDir, setTo);
    process.exit(ok ? 0 : 1);
  }

  const ok = check(rootDir, expected);
  process.exit(ok ? 0 : 1);
}

main();
