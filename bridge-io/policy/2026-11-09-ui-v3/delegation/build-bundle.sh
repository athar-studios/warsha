#!/bin/bash
# C-final local draft bundle builder — RUN ONLY at C-final after INT-REL, in Git Bash on Windows, from the
# integration worktree:  bash .../delegation/build-bundle.sh <version> <worktree>
# Produces dist/release/v<version>/ shaped like v0.2.0 (CREATE_DRAFT_RELEASE.md, RELEASE_MANIFEST.json,
# RELEASE_NOTES.md, upload/). NOTHING is installed, pushed, tagged, uploaded or published.
# Signing material (inventory 2026-11-09): ~/.warsha/signing/keystore.properties + warsha-release.jks exist outside
# the repo; WARSHA_KEYSTORE_FILE unset. apksigner.bat needs java (absent at inventory time) -> GC.14 may be
# uncoverable; record honestly, never fake a verify.
set -u
V="$1"; WT="$2"
EV=C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3
OUT="$WT/dist/release/v$V"
mkdir -p "$OUT/upload" || exit 9
cd "$WT" || exit 9
LOG="$EV/gates/C-final.bundle.log"
: > "$LOG"
run() { echo "== $* at $(date -u +%H:%M:%SZ)" >> "$LOG"; "$@" >> "$LOG" 2>&1; echo "exit=$?" >> "$LOG"; }
# 1 installers (NSIS + MSI) via tauri
run pnpm --filter warsha-desktop exec tauri build --bundles nsis,msi
cp apps/desktop/src-tauri/target/release/bundle/nsis/*-setup.exe "$OUT/upload/Warsha_${V}_x64-setup.exe" >> "$LOG" 2>&1
cp apps/desktop/src-tauri/target/release/bundle/msi/*_en-US.msi "$OUT/upload/Warsha_${V}_x64_en-US.msi" >> "$LOG" 2>&1
# 2 signed APK (owner-scoped local material; gradle reads the signing config)
run bash -c "cd apps/mobile/android && ./gradlew assembleRelease"
cp apps/mobile/android/app/build/outputs/apk/release/app-release.apk "$OUT/upload/warsha-remote-$V-release.apk" >> "$LOG" 2>&1
# 3 docker image tarball (Windows daemon present; WSL has none)
run docker build -t "warsha:$V" docker/
run bash -c "docker save warsha:$V | gzip > '$OUT/upload/warsha-$V-docker-image.tar.gz'"
# 4 SBOMs with the pinned tool
run cargo cyclonedx --format xml --manifest-path crates/warsha-cli/Cargo.toml
run cargo cyclonedx --format xml --manifest-path crates/warshad/Cargo.toml
cp crates/warsha-cli/bom.xml "$OUT/upload/sbom-cli.cdx.xml" >> "$LOG" 2>&1
cp crates/warshad/bom.xml "$OUT/upload/sbom-daemon.cdx.xml" >> "$LOG" 2>&1
# 5 checksums
run bash -c "cd '$OUT/upload' && sha256sum * > checksums.sha256"
echo "BUNDLE_STEPS_DONE version=$V out=$OUT (notes/manifest written by orchestrator; see GC.13-GC.17)"