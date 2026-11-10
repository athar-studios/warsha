# C-final environment inventory — Researcher deliverable, received 2026-11-09 ~10:52Z (read-only)

| tool | state/version | path |
|---|---|---|
| cargo-cyclonedx | **0.5.9 = pinned requirement** | ~/.cargo/bin/cargo-cyclonedx |
| docker (Windows) | CLI + daemon 29.8.2 | C:/Program Files/Docker/.../docker |
| docker (WSL capture) | **MISSING** | — |
| apksigner | present, version UNMEASURED (no java/JAVA_HOME) | .../Android/Sdk/build-tools/36.0.0/apksigner.bat |
| aapt2 | 2.20-13193326 | .../36.0.0/aapt2.exe |
| tauri CLI | tauri-cli 2.12.4 | apps/desktop/node_modules/.bin/tauri |
| makensis | v3.13 | %LOCALAPPDATA%/tauri/NSIS/makensis.exe |
| candle/light (WiX) | 3.14.1.8722 | %LOCALAPPDATA%/tauri/WixTools314/ |
| gitleaks | 8.30.1 | ~/.cargo/bin/gitleaks |
| mdbook | 0.5.4 | ~/.cargo/bin (Win) / /usr/local/bin (WSL) |
| actionlint | Win 1.7.12 / WSL 1.7.7 (mismatch) | WinGet Links / /usr/local/bin |
| node / pnpm / cargo | v26.8.1 / 9.0.0 / 1.99.1 | PATH |

Bundle template `dist/release/v0.2.0/`: root = CREATE_DRAFT_RELEASE.md, RELEASE_MANIFEST.json, RELEASE_NOTES.md,
upload/; upload names = Warsha_0.2.0_x64-setup.exe, Warsha_0.2.0_x64_en-US.msi, checksums.sha256,
sbom-cli.cdx.xml, sbom-daemon.cdx.xml, warsha-0.1.0-docker-image.tar.gz (stale 0.1.0 name in template),
warsha-remote-0.2.0-release.apk.

Signing: references = WARSHA_KEYSTORE_FILE (unset), ~/.warsha/signing/keystore.properties,
~/.warsha/signing/warsha-release.jks. Verdict: properties + jks **exist outside the repo** → a locally signed APK is
NOT an owner-only blocker; in-repo keystore.properties missing (expected; V1.7 ignores it). Contents/validity and
CI secrets NOT inspected (names/existence only).

Versions/workflow: scripts/check-versions.mjs **missing today** — it is V1's deliverable, not a defect now.
Root Cargo.lock: 10 workspace-member version lines (0.2.1); apps/desktop/src-tauri/Cargo.lock: 9.
release.yml: workflow-level `permissions: write` (contents/packages/id-token) inherited by jobs prepare, rust-build,
desktop-build, artifacts, release, manifests, docs; no per-job permissions → exactly V1.5/V1.6's target.

## Implications for C-final (orchestrator assessment)
- GC.17 (`docker run warsha:$RELEASE`) must run on the **Windows** host (docker missing in WSL); gate host is "any".
- GC.14 (apksigner verify) is at risk: apksigner.bat needs java; java/JAVA_HOME absent → environment gap to resolve
  or record as uncovered at C-final (never fake a verify). aapt2 badging works without java.
- actionlint version differs between hosts; V1.4 runs on capture (1.7.7) — record both versions with the gate log.
- SBOM tool matches the pin (0.5.9); NSIS/WiX/tauri present → installers buildable locally.
- Signing material exists locally; validity unverified → attempt at C-final; if invalid/missing password →
  out-of-scope blocker, never faked.