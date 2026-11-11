import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { verifyRelease } from "./verify-release-artifacts.mjs";

const VERSION = "0.3.0";
const TAG = "v0.3.0";

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

/// A synthetic draft directory with every required asset class.
function makeRelease(t, { scope = "signed", omit = [], badSha = false, noChecksums = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-release-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const assets = {
    "warsha-x86_64-unknown-linux-musl": "cli linux",
    "warsha-aarch64-apple-darwin": "cli mac",
    "warshad-x86_64-unknown-linux-musl": "daemon linux",
    "warshad-aarch64-apple-darwin": "daemon mac",
    [`Warsha_${VERSION}_x64-setup.exe`]: "installer",
    "sbom-cli.cdx.xml": "<bom name=\"cli\"/>",
    "sbom-daemon.cdx.xml": "<bom name=\"daemon\"/>",
  };
  if (scope === "signed") assets["latest.json"] = "{}";
  const written = [];
  for (const [name, content] of Object.entries(assets)) {
    if (omit.includes(name)) continue;
    fs.writeFileSync(path.join(dir, name), content);
    written.push({ name, sha: sha256(content) });
  }
  if (!noChecksums) {
    const lines = written.map(({ name, sha }) => {
      const digest = badSha && name.startsWith("warsha-x86_64") ? "0".repeat(64) : sha;
      return `${digest}  ${name}`;
    });
    fs.writeFileSync(path.join(dir, "checksums.sha256"), `${lines.join("\n")}\n`);
  }
  return dir;
}

test("a complete signed draft passes", (t) => {
  const dir = makeRelease(t);
  const result = verifyRelease({ dir, tag: TAG, version: VERSION, scope: "signed", releaseExists: "no" });
  assert.equal(result.ok, true, result.problems.join("; "));
  assert.equal(result.report.signing, "signed");
});

test("a missing checksum file fails", (t) => {
  const dir = makeRelease(t, { noChecksums: true });
  const result = verifyRelease({ dir, tag: TAG, version: VERSION, scope: "signed", releaseExists: "no" });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes("missing checksums.sha256")));
});

test("a mismatched digest fails", (t) => {
  const dir = makeRelease(t, { badSha: true });
  const result = verifyRelease({ dir, tag: TAG, version: VERSION, scope: "signed", releaseExists: "no" });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes("sha256 does not match")));
});

test("a missing required asset fails", (t) => {
  const dir = makeRelease(t, { omit: ["warshad-aarch64-apple-darwin"] });
  const result = verifyRelease({ dir, tag: TAG, version: VERSION, scope: "signed", releaseExists: "no" });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes("missing daemon asset for aarch64")));
});

test("an existing release for the tag fails", (t) => {
  const dir = makeRelease(t);
  const result = verifyRelease({ dir, tag: TAG, version: VERSION, scope: "signed", releaseExists: "yes" });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes("already exists")));
});

test("a tag/version mismatch fails", (t) => {
  const dir = makeRelease(t);
  const result = verifyRelease({ dir, tag: "v9.9.9", version: VERSION, scope: "signed", releaseExists: "no" });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes("does not match version")));
});

test("a signed draft without signing material fails", (t) => {
  const dir = makeRelease(t, { omit: ["latest.json"] });
  const result = verifyRelease({ dir, tag: TAG, version: VERSION, scope: "signed", releaseExists: "no" });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes("no signature or updater manifest")));
});

test("an explicitly unsigned draft passes and says so", (t) => {
  const dir = makeRelease(t, { scope: "unsigned" });
  const result = verifyRelease({ dir, tag: TAG, version: VERSION, scope: "unsigned", releaseExists: "no" });
  assert.equal(result.ok, true, result.problems.join("; "));
  assert.equal(result.report.signing, "unsigned");
});
