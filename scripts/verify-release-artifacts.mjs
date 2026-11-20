#!/usr/bin/env node
// Fail-closed verification of a draft release's assets before public promotion.
//
// The draft is built by release.yml; this script is the gate between "a draft
// exists" and "the draft is public". It never publishes and never edits a
// release. `--release-exists yes` fails: a rerun must not overwrite assets.
//
// Checks: tag/version identity, a non-empty asset set with the CLI, daemon,
// desktop, checksum and SBOM classes present (0.3.0 ships x86_64-only; aarch64
// is informational per D-RN-REL-AARCH64-1), every asset listed in
// checksums.sha256 with a matching digest, and (for the signed scope) a shipped
// signature or updater manifest. The unsigned scope is allowed only when it is
// named explicitly, and the report then says `unsigned`.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const CHECKSUM = "checksums.sha256";
const SBOMS = ["sbom-cli.cdx.xml", "sbom-daemon.cdx.xml"];

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function verifyRelease({ dir, tag, version, scope, releaseExists }) {
  const problems = [];
  const files = [];
  const report = { tag, version, scope, signing: "unsigned", files };

  if (!fs.existsSync(dir)) {
    return {
      ok: false,
      problems: [`asset directory ${dir} does not exist`],
      report,
    };
  }
  for (const name of fs.readdirSync(dir).sort()) {
    const file = path.join(dir, name);
    const stat = fs.statSync(file);
    if (!stat.isFile()) continue;
    files.push({ name, size: stat.size, sha256: sha256File(file) });
  }
  const byName = new Map(files.map((entry) => [entry.name, entry]));
  const names = files.map((entry) => entry.name);
  const has = (pattern) => names.some((name) => pattern.test(name));

  if (releaseExists === true || releaseExists === "yes") {
    problems.push(`a release for ${tag} already exists; refusing to overwrite it`);
  }
  if (tag !== `v${version}`) {
    problems.push(`tag ${tag} does not match version ${version} (expected v${version})`);
  }
  const empty = files.filter((entry) => entry.size === 0).map((entry) => entry.name);
  if (empty.length > 0) {
    problems.push(`empty assets: ${empty.join(", ")}`);
  }

  const checksumEntry = byName.get(CHECKSUM);
  if (!checksumEntry) {
    problems.push(`missing ${CHECKSUM}`);
  } else {
    const listed = new Map();
    const text = fs.readFileSync(path.join(dir, CHECKSUM), "utf8");
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const match = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line);
      if (!match) {
        problems.push(`malformed checksum line: ${line}`);
        continue;
      }
      listed.set(match[2].trim(), match[1]);
    }
    for (const entry of files) {
      if (entry.name === CHECKSUM || SBOMS.includes(entry.name)) continue;
      const recorded = listed.get(entry.name);
      if (!recorded) {
        problems.push(`${entry.name} is not listed in ${CHECKSUM}`);
      } else if (recorded !== entry.sha256) {
        problems.push(`${entry.name} sha256 does not match ${CHECKSUM}`);
      }
    }
    for (const name of listed.keys()) {
      if (!byName.has(name)) {
        problems.push(`${CHECKSUM} names a missing asset ${name}`);
      }
    }
  }

  if (!has(/^warsha-x86_64-/)) problems.push("missing CLI asset for x86_64");
  if (!has(/^warshad-x86_64-/)) problems.push("missing daemon asset for x86_64");

  // 0.3.0 ships x86_64-only per pipeline matrix; aarch64 legs are informational (D-RN-REL-AARCH64-1)
  const notes = [];
  if (!has(/^warsha-aarch64-/)) {
    notes.push("missing CLI asset for aarch64 (informational: 0.3.0 ships x86_64-only per pipeline matrix)");
  }
  if (!has(/^warshad-aarch64-/)) {
    notes.push("missing daemon asset for aarch64 (informational: 0.3.0 ships x86_64-only per pipeline matrix)");
  }
  report.arch = (!has(/^warsha-aarch64-/) || !has(/^warshad-aarch64-/)) ? "x86_64-only" : "multi-arch";
  if (notes.length > 0) {
    report.notes = notes;
  }
  if (!has(/\.(msi|exe|dmg|AppImage|deb)$/)) {
    problems.push("missing a desktop installer");
  }
  for (const sbom of SBOMS) {
    if (!byName.has(sbom)) problems.push(`missing ${sbom}`);
  }

  if (scope === "signed") {
    const signed = has(/\.sig$/) || byName.has("latest.json");
    if (!signed) {
      problems.push(
        "signed scope: no signature or updater manifest (latest.json / *.sig) was shipped"
      );
    }
    report.signing = signed ? "signed" : "missing";
  } else if (scope === "unsigned") {
    report.signing = "unsigned";
  } else {
    problems.push(`unknown signing scope ${scope}; use signed or unsigned`);
    report.signing = "unknown";
  }

  return { ok: problems.length === 0, problems, notes, report };
}

function parseArgs(argv) {
  const args = { dir: "dist", tag: "", version: "", scope: "signed", releaseExists: "no" };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case "--dir":
        args.dir = value;
        index += 1;
        break;
      case "--tag":
        args.tag = value;
        index += 1;
        break;
      case "--version":
        args.version = value;
        index += 1;
        break;
      case "--scope":
        args.scope = value;
        index += 1;
        break;
      case "--release-exists":
        args.releaseExists = value;
        index += 1;
        break;
      default:
        throw new Error(`unknown argument ${flag}`);
    }
  }
  return args;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`verify-release: ${error.message}`);
    return 2;
  }
  const result = verifyRelease({
    dir: args.dir,
    tag: args.tag,
    version: args.version,
    scope: args.scope,
    releaseExists: args.releaseExists,
  });
  console.log(JSON.stringify(result.report, null, 2));
  if (result.notes && result.notes.length > 0) {
    for (const note of result.notes) {
      console.log(`verify-release: note: ${note}`);
    }
  }
  if (!result.ok) {
    for (const problem of result.problems) {
      console.error(`verify-release: ${problem}`);
    }
    console.error("verify-release: FAILED (the draft stays unpublished)");
    return 1;
  }
  console.log(
    `verify-release: OK ${args.tag} ${args.scope} (${result.report.files.length} assets)`
  );
  return 0;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]);
if (invoked && invoked === path.resolve(new URL(import.meta.url).pathname)) {
  process.exit(main());
}
