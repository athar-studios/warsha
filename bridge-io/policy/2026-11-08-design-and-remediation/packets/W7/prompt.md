# Worker prompt — W7 · Android web-asset sync and signed APK (`apps/mobile`) — Wave A

You are the IMPLEMENTER for packet W7 of run `2026-11-08-design-and-remediation` in the Warsha repo
(main checkout `C:/Users/Dragonfly/Downloads/Warsha`). A separate reviewer and verifier judge your work
against the frozen gates below; you must not edit, weaken or reinterpret them. Never ask questions:
decide, record the decision in your report, continue.

**Credential scope.** The owner scoped exactly one credential to this packet: the existing release
signing material — env `WARSHA_KEYSTORE_FILE`, `WARSHA_KEYSTORE_PASSWORD`, `WARSHA_KEY_ALIAS`,
`WARSHA_KEY_PASSWORD`, or `~/.warsha/signing/keystore.properties` (+ `warsha-release.jks`), read by
`apps/mobile/android/app/build.gradle:17-51`. Never print, copy, commit or log a password, alias
secret or keystore content. If the material, the JDK or the Android SDK is missing, stop with an
out-of-scope blocker — never sign with a debug key and call it release.

## 0. Read first
`AGENTS.md`; `ENGINEERING_POLICY.md` (§1 Phase 3, §5, §6 — secrets); `apps/mobile/README.md`,
`apps/mobile/capacitor.config.json` (`webDir: ../remote/dist`), `apps/mobile/android/app/build.gradle`
(`syncRemoteWebAssets` Sync task `:110-137`, hooked to `preBuild` `:141-143`; release signing
`:171-185`), `apps/mobile/.gitignore` (`android/app/src/main/assets/public/` is ignored — synced assets
are build output, never committed); run state
`C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/state.json`.

## 1. Worktree and branch (Git Bash)
```bash
cd C:/Users/Dragonfly/Downloads/Warsha
git worktree add ../warsha-wt/w7 -b run/2026-11-08/w7-android-apk run/2026-11-08/integration
cd ../warsha-wt/w7
BASE=$(git rev-parse HEAD); echo "BASE=$BASE"
pnpm install --frozen-lockfile
# Toolchain (Android Studio JBR + SDK); adjust only if your install differs, and record what you used
export JAVA_HOME="C:/Program Files/Android/Android Studio/jbr"
export ANDROID_HOME="$LOCALAPPDATA/Android/Sdk"
EV=C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/packets/W7
mkdir -p "$EV"
```

## 2. Scope
allowed_files: `apps/mobile/**` — in practice `apps/mobile/README.md` (artifact facts); Gradle/Capacitor
files only if a real packaging defect blocks the build (record it as a decision).

out_of_scope: `apps/remote/**` (you build it, you do not edit it), keystore/`keystore.properties`
content, `scripts/generate-android-keystore.sh`, dependencies, `.github/**`,
`PLAN.md`/`PROGRESS.md`/`DECISIONS.md`. Do not commit the APK or `assets/public/`.

## 3. Steps
1. Build the remote bundle: `pnpm --filter warsha-remote build` — confirm `apps/remote/dist/index.html`
   and `apps/remote/dist/sw.js` exist.
2. Package: `cd apps/mobile/android && ./gradlew assembleRelease --no-daemon 2>&1 | tee "$EV/gradle.log"`
   (`preBuild` runs `syncRemoteWebAssets`, filling `app/src/main/assets/public`). Confirm the sync
   happened (`ls app/src/main/assets/public` shows `index.html`, `sw.js`).
3. Verify the signature: `"$ANDROID_HOME"/build-tools/<newest>/apksigner(.bat) verify --verbose
   --print-certs app/build/outputs/apk/release/app-release.apk 2>&1 | tee "$EV/apksigner.log"`
   (certificate digests are public; nothing secret is printed).
4. Prove the web assets are inside: `unzip -l app/build/outputs/apk/release/app-release.apk | grep -E
   'assets/public/(index\.html|sw\.js)$'` (or `jar tf`).
5. Measure: byte size (`stat -c %s`) and `sha256sum` of the APK; write both, the build date, the
   `BASE` commit, the toolchain versions and the apksigner verdict into a new "Release artifact"
   section of `apps/mobile/README.md` (the hash as one 64-hex token on its own line) and into `"$EV/artifact.txt"`.
6. Small Conventional Commit (`docs(mobile): record the signed release APK …`). Do not push.

## 4. Frozen verification gates
Each gate is one command; expected result in the comment above it. Run from the worktree root with
`JAVA_HOME`/`ANDROID_HOME` set as in §1; `APK=apps/mobile/android/app/build/outputs/apk/release/app-release.apk`.
```bash
# G7.S scope — expect output: 0
git diff --name-only $BASE..HEAD | grep -vE '^apps/mobile/' | wc -l
# G7.1 — expect exit 0
pnpm --filter warsha-remote build && test -f apps/remote/dist/sw.js && test -f apps/remote/dist/index.html
# G7.2 — expect exit 0
( cd apps/mobile/android && ./gradlew assembleRelease --no-daemon )
# G7.3 — expect exit 0 (use the newest build-tools apksigner)
"$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)"/apksigner verify --print-certs "$APK"
# G7.4 — expect output: 2
unzip -l "$APK" | grep -cE 'assets/public/(index\.html|sw\.js)$'
# G7.5 README hash equals the built APK — expect exit 0
grep -qF "$(sha256sum "$APK" | cut -d' ' -f1)" apps/mobile/README.md
# G7.6 no secret in evidence — expect exit 1 (no match)
# OWNER-AMENDED (OD2, value-anchored): match a credential field ASSIGNED A VALUE, never a bare field name.
# The previous pattern matched any file quoting the field names — this brief and the verification report
# both do — so the gate could never pass. This form keeps every evidence file in scope.
grep -rniE '(storePassword|keyPassword)[[:space:]]*[=:][[:space:]]*[A-Za-z0-9\'']|WARSHA_KEYSTORE_PASSWORD=[A-Za-z0-9\'']|WARSHA_KEY_PASSWORD=[A-Za-z0-9\'']' C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/packets/W7
# G7.7 assets stay untracked — expect output: 0
git ls-files apps/mobile/android/app/src/main/assets | wc -l
# G7.A / G7.P — expect exit 0 each
node scripts/check-arch.mjs
node scripts/check-engineering-policy.mjs
```

## 5. Report and stop
Write `C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/packets/W7/report.md`:
BASE, HEAD, `git diff --stat $BASE..HEAD`, toolchain versions, APK path/size/SHA-256, apksigner
verdict (redacted of anything secret), decisions, your own gate run with exit codes (not evidence),
open issues. Missing SDK/JDK/signing material → blocker `{kind: out-of-scope, reason, needs}`. No
edits to `PLAN.md`/`PROGRESS.md`/`DECISIONS.md`; no merge; no push.
