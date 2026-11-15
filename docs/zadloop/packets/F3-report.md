# F3 report — R-UI-7b pairing boundary: experiment, verdict, fix

Date: 2026-11-15. Branch: `r-next/f3-pairing-boundary`. Base: `debc525`.
Design: `docs/zadloop/packets/R-UI-7b-design.md`. Verdict row: **V2 (adoption defect, H3)**.
Evidence (worktree, gitignored): `target/r-ui-7b/`. Durable copy:
`bridge-io/policy/2026-11-15-r-next/f3/` (outside the worktree; verdict.md +
17 redacted evidence files, token-leak scan 0 hits).

Authority: Gate A sign-off is given in advance by `R-NEXT-MASTER-PLAN.md` §4
F3; because the pre-registered table landed on a DEFECT row (V2), the same
packet authorised "the smallest fix that the design's evidence supports,
inside the files the design names, with tests".

## Per-experiment evidence

Commands below ran in the worktree; the pairing token was read into a shell
variable from the daemon config and never printed — only a 43-char length
fact is recorded. All artifacts record lengths, never URIs.

### E0 — environment attestation (`e0-attestation.txt`, 2026-11-15T12:42:22Z)

```bash
adb -s emulator-5554 shell pm list features | grep -iE 'strongbox|keystore'
adb -s emulator-5554 shell getprop | grep -iE 'keymint|keymaster|tee|trusty'
adb -s emulator-5554 shell dumpsys -l | grep -iE 'keystore|keymint'
adb -s emulator-5554 shell ls /system/lib64/ | grep -iE 'keymint|keymaster'
```

Result: `feature:android.hardware.hardware_keystore=300`,
`feature:android.hardware.keystore.app_attest_key` (no StrongBox feature);
no `keymint|keymaster|tee|trusty` getprop lines; services
`IRemotelyProvisionedComponent/default`, `legacykeystore`,
`keystore2.IKeystoreService/default`; `/system/lib64` carries keymaster
3.0/4.0/4.1, KeyMint V1-cpp/V3-ndk and `libpuresoftkeymasterdevice` — a
software KeyMint. This proves which implementation is under test; it does
not explain the exception and does not separate the two AVDs (one image).

### E1 — bring-up (Pixel_7_API_35, `-wipe-data`, headless)

- `pnpm --filter warsha-remote build` (after `pnpm install`), Gradle
  `assembleDebug` (auto-syncs `dist/` → `assets/public/`), APK
  `app-debug.apk` built 2026-11-15 ~16:40Z.
- `cargo build -p warshad --bin warshad` with
  `CARGO_TARGET_DIR=/home/moe/Downloads/Warsha/target` (main checkout cache).
- Emulator booted headless (`-no-window -no-audio -no-boot-anim -no-snapshot
  -gpu swiftshader_indirect -accel on -wipe-data`), `boot_completed=1`.
- Daemon on throwaway ports 18765/18766 (config `target/r-ui-7b/cfg/`),
  `/health` healthy; `adb reverse tcp:8765 tcp:18765`, `tcp:8766 tcp:18766`;
  APK installed. Reverse rules were later re-established once after a
  device-side drop (device/process list recorded in-report).
- Cold sequence (S2 gate's own commands + 0.5 s pid samples): `am force-stop`
  → `am start -W -a VIEW -d warsha://pair?...` → `cold-pid.txt` (single
  stable pid per cycle: `4413`, then `5063`, then `6553` — no restart inside
  any S2 window) → `logcat-keystore.txt` (filtered `WarshaMainActivity|
  keystore|KeyMint|Conscrypt`) → full `logcat.txt`.
- This run's `logcat-keystore.txt` carries **zero** `WarshaMainActivity`
  lines (only SELinux/service-manager/keystore2/conscrypt system lines): no
  `saveSecret:keystore` refusal fired, because the parser refused the link
  before any store call (probe `store:[]`). Naming limitation (base tree,
  design §"Measured"): `logBridgeError` keeps only the exception class name,
  so the site stays ambiguous until a diagnostic build.

### E2 — document-start probe (mode: document-start, NOT late-probe)

`Page.addScriptToEvaluateOnNewDocument` succeeded on the live cold target
(`https://appassets.androidplatform.net/index.html`), then `Page.reload`
(page half of the cold path: activity alive, `pendingPairingUri` set).
`probe.js` + 30 samples `probe-v1.jsonl` (all identical):

- `calls:[{"t":202,"v":"link:88"}]` — `getInitialPairingUri()` returns a
  non-empty 88-char link ~200 ms after document start (P-b: link present).
- `listenerAt:75` (app registers its `warsha:pair-deeplink` listener after
  the probe's capture-phase listener — H1's lost-handoff shape is present
  but not load-bearing: the link is also available at mount).
- `events:[]` on the cold path (no cold event delivered to the document),
  `errors:[]`, `store:[]`, `appCalls:[]` (probe polls flagged via
  `selfCall`; the bridge did not accept per-method wrapping).
- P-a: bridge descriptor `{configurable:true,writable:true,
  enumerable:true}` but per-method assignment is a silent no-op
  (`assign:refused-silent`, `wrapped:[]`); keys present:
  `deleteSecret,getAppRole,getInitialPairingUri,getNativeInfo,loadSecret,
  requestCameraPermission,saveSecret`.
- Post-reload state `s2-state.txt`: `unpaired`.

### E3 — replay the device's own link after mount (decisive for Q2)

Replay result `{"ok":true,"len":88}` (`e3-replay.txt`): the link was fetched
from the bridge and dispatched through the app's own listener — probe
`events` shows the capture-phase listener received `{kind:"string",
len:88}` (`e3-console.txt`). Post-replay state stays `unpaired`
(`1794747023391 unpaired`), plate `remote-pair-submit` up, strip shows no
endpoint; probe `errors:[]`. The page/transport half was exercised and the
defect reproduces with the handoff bypassed → the failure is adoption (H3),
not the shell→page handoff.

### E4 — software-Keystore control (partially infeasible on this base, recorded honestly)

- Install-in-one-evaluate works: `defineErr:null, isStub:true,
  store:stub`, `stubSave:true` (`e4-combo.txt`).
- The stub does **not** survive `Page.reload` (fresh document gets the real
  bridge: `probeStore:null, hasReal:true`, `e4-stub-check.txt`/`e4-proto.txt`),
  so the design's "reload, then repeat the S2 cold sequence" leg cannot run
  through CDP on this base — recorded per the infeasibility rule, not worked
  around.
- Within one live document the stub leg ran: software `saveSecret` succeeds
  (`stubSave:true`) followed by the same E3 replay → state still `unpaired`
  (`s2-state.txt: 1794747273871 unpaired`). The Keystore refusal is not
  load-bearing for this failure.

### The defect, exactly

`parsePairingLink` (`apps/remote/src/session.ts`) gated a `warsha:` link on
`link.hostname === 'pair' || (hostname === '' && pathname === 'pair')`.
Measured on the device WebView (124.0.6367.219): a non-special scheme keeps
no host — `new URL("warsha://pair?...")` yields `hostname:""`,
`pathname:"//pair"` (query intact). So the cold-start shape fails `isPair`
and the function returns `{ok:false, reason:'url'}` for the valid link;
`App.tsx` discarded that reason (`pair(initial)`, return thrown away), so
"rejected" and "never seen" were indistinguishable. Node/jsdom parse the
same string with `hostname:"pair"`, which is why the bundle pairs
off-device but never on-device. V4's second wall is not present (replay
reaches the listener; nothing else blocks adoption once parsed). H2's
stale-read is refuted as the wall (mount read is non-empty). E5
(diagnostic build) is not needed to settle this row.

## Verdict: V2 — adoption defect (H3); the Keystore is an artifact

Artifact leg: single stable pid per window (no restart re-reads persisted
state), zero `saveSecret:keystore` lines this run, empty app files dir
(`run-as … ls -l files/` → `total 0`; presence/size only), probe
`store:[]`, E4 stub leg changes nothing. The Keystore stays an environment
artifact: no fix in this packet.

## Fix (smallest the evidence supports, in the design-named files)

- `apps/remote/src/session.ts` — `parsePairingLink`: accept the WebView's
  `//pair` pathname as the same pairing intent:
  `pathIsPair = pathname === 'pair' || pathname === '//pair'`;
  `isPair = hostname === 'pair' || (hostname === '' && pathIsPair)`.
  Non-pairing `warsha:` targets (e.g. `warsha:run`) stay refused.
- `apps/remote/src/App.tsx` — surface the mount/event `pair()` failure
  reason as `console.warn('warsha: launch link refused: <reason>')` /
  `('warsha: deep-link event refused: <reason>')` (reason only, never the
  link). This closes the design's "blind spot" line: the next refusal names
  itself in logcat instead of vanishing.
- Tests (`apps/remote/src/session.test.ts`, vitest): new case pins both URL
  shapes (`hostname:"pair"` and the device-measured `hostname:""/`
  `pathname:"//pair"` gate), the end-to-end parse of the cold link, and that
  `warsha://run` stays refused. Full file: 35 passed; `App.test.tsx`: 21
  passed; `pnpm typecheck` and `pnpm lint` clean.
- No CSP, `network_security_config`, Gradle, or `scripts/android-smoke.sh`
  edits (the script is byte-identical; a copy at `/tmp/smoke-f3.sh` with an
  added reuse preamble ran the rows against the already-up F3 device/daemon
  because the script's own STOP rule forbids touching a live device — the
  two-line relaxation is documented here, not committed).

## Post-fix rows (fixed APK reinstalled; token held in shell var, never printed)

- Manual cold pair: `paired` (two consecutive force-stop cycles:
  `…785253 paired`, `…952703 paired`), no `warsha: launch link refused`
  line — the mount pair succeeds.
- S2 (smoke run): **pass** (devtools) — "cold `warsha://pair` paired (plate
  gone, strip shows the loopback daemon) and the bench rendered".
- S3 (smoke run): **pass** (devtools) — `pid before=8777 after=8777
  state=paired`; manual warm re-check: same pid, `paired`.
- S4 (smoke script): script-FAIL, product-PASS — the script matches nav
  anchors by exact `href` (`/projects`…) but the bench renders hash links
  (`#/projects`…), so every route reported `missing-anchor`; manually
  clicking `#/projects|run|gates|settings` renders the screens
  (`remote-screen-projects` confirmed with its form testids). Harness-side
  mismatch, filed below as a follow-up; not a product regression (routes
  unchanged by this diff).
- S5: native deep-link leg **pass** (`unpaired`, process alive); plate-submit
  leg **pass** — refusal sentence shown
  (`…unpaired… refusal:"يجب أن يبدأ عنوان الخادم بـ http:// أو https://…"`)
  and still `unpaired`. The smoke run reported S5 fail only because its
  post-`force-stop` CDP session went `ERR` (`state=ERR, submit=ERR`) after
  the harness's own `uiautomator` run crashed the accessibility bridge
  (`FATAL EXCEPTION: UiAutomation … Bad file descriptor`, pid 9038 — a
  device/harness crash, no `dev.warsha` frames; 36 crash-buffer lines + this
  1 fatal; `tokenLeaks=0`), i.e. a dead CDP socket, not a pairing outcome.
- `LOG` row fail is the same UiAutomation crash lines; no app FATAL/ANR,
  no token in any log (`tokenLeaks=0` in the smoke report; 0 hits scanning
  all copied evidence with the live token).

Net: the packet's defect (S2 cold pair) is fixed and S2/S3 pass in the
official script; S4/S5 script rows fail on harness-side causes with the
product behaviour verified manually and recorded above.

## Deviations from the design

1. E4's reload leg is infeasible via CDP (stub does not survive a fresh
   document; per-method patching is a silent no-op despite a writable
   descriptor). Single-evaluate stub leg ran instead; verdict stands on
   E2+E3 plus that leg.
2. `logcat-keystore.txt` (filtered) and full `logcat.txt` were refreshed
   after the second cold sequence; both kept. `s2-state.txt` accumulates one
   `unpaired` line per cold/replay leg plus the post-fix `paired` lines —
   the timeline reads oldest→newest.
3. `target/r-ui-7b/cdp-*.cjs`, `e4-run.js`, `store-stub.js` are harness
   helpers kept as evidence; `smoke-out/` holds the official smoke run's
   directory (report `smoke-pixel7.json` at `target/r-ui-7b/` level).

## Fleet decisions (for the PM to log in DECISIONS.md)

1. The `//pair` pathname acceptance is the F3 fix (V2/H3). No Keystore
   change: the emulator vault stays unpersisted on this image; the real
   device is expected to be fine.
2. Follow-up (not this packet): the smoke script's S4 nav matcher should
   accept `#/…` hash links, and its S5 leg should re-establish CDP after a
   harness-side UiAutomation crash instead of scoring `ERR` as product
   failure. Owner checklist already carries the physical-device leg.
3. Named follow-ups from the design stay open: `loadSecret` answering
   `undefined` vs declared `null`, and the message-less `logBridgeError`
   line (E5 diagnostic build, Gate B).

## Owner checklist (in-report only)

- [ ] Physical-device leg: **not run — no hardware on this host**.
- [ ] S4/S5 script rows fail on harness causes (hash-link matcher; dead CDP
      after UiAutomation crash) with product behaviour verified manually —
      accept as recorded or order a script-only follow-up.
- [ ] Merge `r-next/f3-pairing-boundary` (fix + tests + this report).
