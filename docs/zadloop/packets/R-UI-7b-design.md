# R-UI-7b — design: the Android pairing boundary — emulator-Keystore artifact vs real bridge defect

Status: **design frozen; owner sign-off required before any implementation.**
Planner lane, research + document only: nothing under `apps/`, `crates/`, `packages/` or `scripts/` was
edited, no APK was built, no emulator was booted, and **no experiment in §"Experiment plan" has been run
yet** — every base fact below is a read of the tree at `988a6c4` plus the two prior lane reports.
Base: `988a6c4` (`repair/dev-csp-f474776`). Branch `r-ui-7b-design`, one file added (this one).
Queue: `R-FIN-audit.md:82` (owner unblock item 3); `DECISIONS.md:1856` and `PROGRESS.md:6798` name this
packet as the next step.

## What this packet is, and is not

It **is** the owner-requested separation: (a) a Keystore-artifact experiment that a local host can actually
discriminate; (b) the bridge-defect hypothesis with the exact failing call chain; (c) pre-registered success
criteria that say when the Keystore refusal is an artifact and when the failure is a real defect; (d) a
sign-off gate that keeps implementation out of scope until the owner signs.

It is **not** a fix, not an authorization to fix, and not a claim that either candidate is the cause. It also
does not modify `scripts/android-smoke.sh`: its S2 gate stays exactly as measured in `R-UI-7` until a
separate, signed packet touches it.

## Measured at the base (`988a6c4`)

### The bridge object and the Keystore chain

`MainActivity` builds one `WarshaNative` and registers it as `window.WarshaNative`
(`MainActivity.java:95-96`), framework-only, `minSdk 24`, `targetSdk 35`, `applicationId dev.warsha.remote`
(`apps/mobile/android/app/build.gradle:55-62`), activity `launchMode="singleTask"` with one `VIEW`/`warsha`
intent filter (`AndroidManifest.xml:24-46`).

The Keystore call chain, exactly as it runs today:

```
page: nativeSessionStore.setItem          apps/remote/src/session.ts:110-114
  → throws locally if saveSecret returns false ("native keystore refused the write")
  → window.WarshaNative.saveSecret(k, v)  @JavascriptInterface dispatch (JavaBridge worker thread)
  → WarshaNative.saveSecret               WarshaNative.java:88-118 (synchronized)
      → getOrCreateAesKey()               WarshaNative.java:231-255
          KeyStore.getInstance("AndroidKeyStore"); keyStore.load(null); keyStore.getEntry(alias)
          KeyGenerator.getInstance(AES, "AndroidKeyStore")
          generator.init(new KeyGenParameterSpec.Builder(...)    WarshaNative.java:244-253
              .setBlockModes(GCM), .setEncryptionPaddings(NONE), .setKeySize(256))  → :254 generateKey()
      → Cipher.getInstance("AES/GCM/NoPadding")                  WarshaNative.java:97
      → cipher.init(ENCRYPT_MODE, key, new GCMParameterSpec(128, iv))   WarshaNative.java:98
      → InvalidAlgorithmParameterException  (a GeneralSecurityException)
  → catch (GeneralSecurityException)      WarshaNative.java:111-113
      → activity.logBridgeError("saveSecret:keystore", e)            → MainActivity.java:442-446
      → Log.w(TAG, "native bridge operation failed: saveSecret:keystore (InvalidAlgorithmParameterException)")
      → return false        (never throws into JS)
```

Two consequences that shape everything below:

1. **The exception site is ambiguous in the evidence we have.** `InvalidAlgorithmParameterException` can be
   thrown by `generator.init(...)` (`WarshaNative.java:244`) or by `cipher.init(...)`
   (`WarshaNative.java:98`) — both are `GeneralSecurityException`. `logBridgeError` logs
   `error.getClass().getSimpleName()` and nothing else: **no message, no cause, no stack**
   (`MainActivity.java:442-446`). The message that would name the parameter at fault
   (key size vs IV vs tag length vs padding) is destroyed before it reaches logcat. The only device-side
   artifact that exists is that one line (`R-UI-7-report.md:186-189`): **there is no stack anywhere in the
   reports**, because none is ever passed to `Log.w`. This is a measurement limit of the base tree, not a
   guess about the cause.
2. **The Keystore call is not on the pairing critical path.** `pair()` sets the session in React state
   *before* it stores it (`App.tsx:82-91`: `setSession` at `:86`, `storeSession` at `:87`), `storeSession`
   swallows every store failure (`session.ts:393-401`), and `saveSecret` returns `false` rather than throwing
   (`WarshaNative.java:111-113`). A refused write costs the *remembered* session, not the current one. By
   code, a failing Keystore cannot by itself keep the page unpaired inside one page lifetime; it can only
   matter across a document or process restart, or if the bridge call aborts the effect that adopts the link.

### The pairing handoff (where the defect must be)

Cold path, exactly as the S2 gate performs it (`scripts/android-smoke.sh:757-788`):
`am force-stop dev.warsha.remote` → `am start -W -a android.intent.action.VIEW -d warsha://pair?...`

```
MainActivity.onCreate                       MainActivity.java:80-114
  handleViewIntent(getIntent())  → pendingPairingUri = data.toString()   :112, :304-315, field :71
  webView.loadUrl(START_PAGE)    → https://appassets.androidplatform.net/index.html   :113
MainActivity.onResume                       MainActivity.java:124-128
  dispatchPendingPairing() → webView.evaluateJavascript("window.dispatchEvent(new CustomEvent(
      'warsha:pair-deeplink', {detail: <uri>}))", null)                :317-327
  deliveredPairingUris.add(uri)   — unconditional, no delivery callback  :325-326
page (later): React mounts → effect          apps/remote/src/App.tsx:103-127
  bridge.getInitialPairingUri?.() ?? null    :107   → pair(initial)      :108, result discarded
  window.addEventListener('warsha:pair-deeplink', onDeepLink)           :125
bridge method:
  WarshaNative.getInitialPairingUri          WarshaNative.java:182-185
  → activity.initialPairingUri() → pendingPairingUri                     MainActivity.java:330-332
```

Three structural facts fall out of that read:

- **The event is fired before any document exists.** `onResume` runs immediately after `onCreate`'s
  `loadUrl`, the `evaluateJavascript` callback is `null`, and there is no `onPageFinished` hook anywhere in
  `MainActivity`. The event is delivered into a WebView that has not committed a document.
- **The delivery is marked delivered regardless.** `deliveredPairingUris` is never cleared
  (`MainActivity.java:73`, `:319`, `:326`), so that URI is never offered again — the cold path's only
  remaining chance is the page's own `getInitialPairingUri()` read at mount.
- **The mount read crosses threads without a publication rule.** `pendingPairingUri` is a plain
  `String` field written on the UI thread (`:313`) and read from the `@JavascriptInterface` worker thread
  (`WarshaNative.java:182-185` → `MainActivity.java:330-332`). No `volatile`, no synchronized accessor, no
  `AtomicReference`.

And the page side has its own blind spot: `pair()` returns a `PairingFailure | null` and **the caller throws
that return value away** (`App.tsx:108`), so "the link was rejected" and "the link was never seen" are
indistinguishable in every artifact the lane has produced so far.

### The two AVDs cannot discriminate Keystore behaviour (measured)

The owner's example experiment was `Athar_GPlay` vs `Pixel_7_API_35` attestation behaviour. Measured on this
host, that comparison cannot separate anything Keystore-related:

| Fact | `Athar_GPlay` | `Pixel_7_API_35` |
| --- | --- | --- |
| `image.sysdir.1` | `system-images/android-35/google_apis_playstore/x86_64/` | **same** |
| `tag.id` | `google_apis_playstore` | **same** |
| `abi.type` / `hw.cpu.arch` | `x86_64` | **same** |
| `PlayStore.enabled` | `no` | `yes` |
| `hw.gpu.enabled` | `no` | `yes` |
| `hw.keyboard` | `no` | `yes` |
| `hw.ramSize` | `2G` | `2048` |

Both AVDs run the **same** system image, so both get the same emulator KeyMint/keystore implementation. The
only per-AVD differences are GPU, keyboard, RAM and the Play Store flag, plus the script's own asymmetry
(`-wipe-data` for `Pixel_7_API_35` only, `scripts/android-smoke.sh:566-569`; uninstall-first install for the
other, `:626-629`). Only one system image is installed on this host
(`$ANDROID_HOME/system-images/android-35/google_apis_playstore/x86_64`, sole entry), and no physical device
was attached at the base (`adb devices` empty). A hardware-backed vs emulator comparison is therefore
**not runnable on this host as specified**; §"Experiment plan" E4 replaces it with a control that is.

### What the S2 gate can and cannot see

- `PAIRED_STATE_JS` reads the pairing plate and the strip's endpoint host
  (`scripts/android-smoke.sh:416-423`; the strip prints `endpointHost(session)` only when a session exists,
  `apps/remote/src/chrome.tsx:259-263`, `session.ts:457-464`). It is a sound signal of "this page holds a
  session" and it reported `unpaired` in both `R-UI-7` runs.
- The bench clause (`poll_js '[data-testid="remote-screen-needs-you"]'`, `:773`) can be satisfied by the
  *unpaired* placeholder: `NeedsYouScreen` renders `<UnpairedScreen testId="remote-screen-needs-you">`
  (`apps/remote/src/screens/NeedsYouScreen.tsx:88`, same shape in `ProjectsScreen.tsx:63`). So the S2 log
  line "reached a paired bench" can be produced without a paired bench; only the `state=paired` clause is
  load-bearing today.
- Nothing in the script reads a bridge log line: no grep for `InvalidAlgorithmParameterException`,
  `keystore`, `KeyMint`, `Conscrypt` or `WarshaMainActivity` anywhere in 925 lines. `logcat.txt` is a full
  dump, so the evidence exists — it is just not asserted on.
- The debug APK is `debuggable`, so `adb shell run-as dev.warsha.remote ls -l files/` is available to see
  whether a vault file was ever written (presence/size only — never its contents; it holds ciphertext).
- The script has no `--keep`/`--no-teardown` flag (`:51-58` only accept `--avd`, `--report`): the
  experiments below must bring the device up themselves.

### Host inventory for the experiment (measured)

`/dev/kvm` present; `$ANDROID_HOME=/home/moe/Android/Sdk` with `emulator` and `platform-tools/adb`;
exactly one system image (above); `target/` is gitignored (`.gitignore:2`); `warshad` builds from
`cargo build -p warshad --bin warshad` (the smoke script does this itself, `scripts/android-smoke.sh:517-523`).

## The two questions, and what settles each

- **Q1 — artifact:** does the Keystore refusal change the pairing outcome? Settled by running the same
  pairing path against a **software** secret store on the same device, same APK, same page (`E4`). It is
  *not* settled by comparing the two AVDs (above), and not settled by the Chromium variants already measured
  in `R-UI-7` (those used a scripted bridge in a desktop browser; that lane's
  `target/discrimination/r-ui-7/variants.cjs`, gitignored evidence not present in this checkout).
- **Q2 — defect:** where does the deep link die — before the page (shell handoff), or inside the page
  (adoption/parse/store/transport)? Settled by a document-start probe plus a post-mount replay (`E2`, `E3`).

## Hypotheses (exact chains, and the observation that decides each)

| # | Hypothesis | Exact chain | Deciding observation |
| --- | --- | --- | --- |
| **H1** | **Lost handoff by construction.** The cold path's event is fired into a document that does not exist yet and is marked delivered unconditionally; the fallback read is the only handoff that can work. | `onCreate ++ onResume` → `dispatchPendingPairing` (`MainActivity.java:127`, `:317-327`) → `evaluateJavascript` before document commit → dropped; `deliveredPairingUris.add` (`:326`); no `onPageFinished` re-dispatch | P-c: the event arrives **after** the app's own listener is registered (`listenerAt` earlier than the event's `t`). Confirmed when the event arrives before `listenerAt`, or is never seen on the cold path at all |
| **H2** | **Stale read at mount.** The fallback read on the JavaBridge thread observes the field's initial `null` because nothing publishes the UI-thread write. | `pendingPairingUri` (`MainActivity.java:71`) written `:313` (UI) / read `:330-332` (JavaBridge) → `WarshaNative.java:182-185` → `App.tsx:107` sees `null`/`undefined` → effect registers the listener only | P-b/P-d: a non-empty link at document-start or on the app's own call. (If the method cannot be wrapped, only the `E5` build settles it) |
| **H3** | **Adoption rejects the device link.** The page receives the link but `parsePairingLink`/session build refuses it on device. | `App.tsx:108` → `pair` → `parsePairingLink` → `PairingFailure` discarded at `:108`; no store write follows | `E3` replay of the *device's own* link via the app's listener pairs the bench (plate gone, strip shows the endpoint) |
| **H4** | **Adopted but unreachable.** The session exists and the bench cannot render because the loopback transport fails; the plate reading is then a symptom. | `App.tsx:86` setSession → provider → WS `ws://127.0.0.1:8766` via `adb reverse`; failure would leave the plate absent and the strip showing the endpoint | Already refuted for this packet's red: H4 needs the plate **absent** and the strip showing the endpoint; the measured `unpaired` means the page state holds no session, and the strip prints nothing without one |
| **H5** | **Coupling.** The refusal is load-bearing only across a reload/restart: nothing persists, so any document or process restart returns the page to the plate. | `saveSecret` → `false` → `session.ts:111-112` throws → `storeSession` swallows (`:392-401`) → session in memory only; a restart re-reads `readStoredSession` (`:366-390`) → `null` → plate | E4: the stub-store run reproduces the native run's failure **and** `cold-pid.txt` shows no restart inside the window (confirmed if the stub run pairs where the native run does not) |

H4 is the weakest: the measured `state=unpaired` means the page's own state has no session, and no code path
in `apps/remote/src` calls `unpair()` on transport failure (`grep removeSession|clearSession|location.reload`
→ 0 hits). It stays in the table because it is cheap to falsify with the same probe.

## Experiment plan (read-only; each step needs the sign-off in §"SIGN-OFF GATE")

All evidence goes under `target/r-ui-7b/` (gitignored). **The pairing token is never printed**: read it into
a shell variable from the daemon's own config, as the smoke script does
(`scripts/android-smoke.sh:547-555`), never `echo` it, and let only `length`-based facts reach an artifact
(the probe below stores no URI, only its length).

### E0 — environment attestation (what the device's Keystore *is*)

```bash
adb -s emulator-5554 shell pm list features | grep -iE 'strongbox|keystore'
adb -s emulator-5554 shell getprop | grep -iE 'keymint|keymaster|tee|trusty'
adb -s emulator-5554 shell dumpsys -l | grep -iE 'keystore|keymint'
adb -s emulator-5554 shell ls /system/lib64/ | grep -iE 'keymint|keymaster'
```

Records what this emulator image claims (expected on both AVDs: no StrongBox feature, a software
KeyMint/keymaster service, no TEE). It **proves** only which implementation is under test; it does not
explain the exception and it does not separate the two AVDs (they are one image, above).

### E1 — bring the device up (manual; the script cannot keep a run alive)

```bash
# APK (R-UI-6b/C state: assembleDebug works from clean; no -x needed)
pnpm --filter warsha-remote build
rsync -a --delete --exclude '*.map' apps/remote/dist/ apps/mobile/android/app/src/main/assets/public/
(cd apps/mobile/android && bash ./gradlew assembleDebug --no-daemon)

# emulator (Pixel_7_API_35 is the wipe-data pass; Athar_GPlay runs without -wipe-data)
$HOME/Android/Sdk/emulator/emulator -avd Pixel_7_API_35 -no-window -no-audio -no-boot-anim \
  -no-snapshot -gpu swiftshader_indirect -accel on -wipe-data &
adb wait-for-device
adb shell 'while [ "$(getprop sys.boot_completed)" != "1" ]; do sleep 1; done'
adb shell input keyevent KEYCODE_WAKEUP; adb shell wm dismiss-keyguard

# daemon on this run's throwaway tree (host ports 18765/18766, as R-UI-5/7 did)
mkdir -p target/r-ui-7b/cfg target/r-ui-7b/data target/r-ui-7b/home
env XDG_CONFIG_HOME="$PWD/target/r-ui-7b/home/.config" \
    XDG_DATA_HOME="$PWD/target/r-ui-7b/home/.local/share" \
    XDG_CACHE_HOME="$PWD/target/r-ui-7b/home/.cache" \
    XDG_STATE_HOME="$PWD/target/r-ui-7b/home/.local/state" \
    WARSHA_DATA_DIR="$PWD/target/r-ui-7b/data" \
    target/debug/warshad --foreground --config "$PWD/target/r-ui-7b/cfg/config.toml" \
      --http-port 18765 --ws-port 18766 >>target/r-ui-7b/daemon.log 2>&1 &
curl -fsS http://127.0.0.1:18765/health
TOK=$(sed -n 's/^auth_token *= *"\([^"]*\)".*/\1/p' target/r-ui-7b/cfg/config.toml | head -1)

adb reverse tcp:8765 tcp:18765
adb reverse tcp:8766 tcp:18766
adb install -r apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

The cold sequence under measurement — the S2 gate's own commands, plus a pid sample every 0.5 s so a process
restart inside the window is a fact, not a theory (`am start` output is discarded; it can echo the URI):

```bash
adb shell am force-stop dev.warsha.remote
adb shell "am start -W -a android.intent.action.VIEW -d 'warsha://pair?host=127.0.0.1&port=8765&token=$TOK' dev.warsha.remote" >/dev/null 2>&1
printf 'am start exit=%s\n' "$?" >>target/r-ui-7b/cold-start.txt
: >target/r-ui-7b/logcat-keystore.txt
for i in $(seq 1 30); do
  printf '%s %s\n' "$(date +%s)" "$(adb shell pidof dev.warsha.remote | tr -d '\r')" >>target/r-ui-7b/cold-pid.txt
  adb shell logcat -d -b all | grep -E 'WarshaMainActivity|keystore|KeyMint|Conscrypt' >>target/r-ui-7b/logcat-keystore.txt
  sleep 0.5
done
```

### E2 — document-start probe (the observation the lane never had)

The probe is installed by `Page.addScriptToEvaluateOnNewDocument`, i.e. before any page script, and its own
`installedAt` records how late it arrived. It records, without ever storing a URI:

- **P-a** whether `window.WarshaNative` can be replaced/patched (`Object.getOwnPropertyDescriptor`) — decides
  E4's feasibility;
- **P-b** a 200 ms timeline of `getInitialPairingUri()`, recording `link:<len>` / `null` / `no-bridge` / the
  thrown error string;
- **P-c** every `warsha:pair-deeplink` event seen by a *capture-phase* listener registered at document-start,
  with its timestamp, plus the timestamp at which the app registers its own listener — this is the direct
  H1 observation;
- **P-d** the app's *own* `getInitialPairingUri()` call (recorded by wrapping that bridge method, separated from
  the probe's own polls by a flag) plus `saveSecret`/`loadSecret`/`deleteSecret` call counts and outcomes — the
  decisive H2 datum and the store evidence, if the Java bridge object accepts monkey-patching (P-a reports
  whether it does);
- **P-e** `error`/`unhandledrejection` lines — an effect that throws is otherwise only a console line.

Probe source (`target/r-ui-7b/probe.js`):

```js
(() => {
  const t0 = performance.now();
  const now = () => Math.round(performance.now() - t0);
  const rec = (window.__warshaProbe = {
    installedAt: Date.now(), t0, desc: null, wrapped: [], tried: false, selfCall: false,
    calls: [], appCalls: [], events: [], listenerAt: null, store: [], errors: [],
  });
  const shape = (v) => (typeof v === 'string' ? (v === '' ? 'empty' : `link:${v.length}`) : String(v));

  const d = Object.getOwnPropertyDescriptor(window, 'WarshaNative');
  rec.desc = d ? { configurable: d.configurable, writable: d.writable, enumerable: d.enumerable } : null;

  window.addEventListener('warsha:pair-deeplink', (e) => {
    const det = e.detail;
    rec.events.push({ t: now(), kind: typeof det, len: typeof det === 'string' ? det.length : null });
  }, true);

  const add = window.addEventListener.bind(window);
  window.addEventListener = function (type, fn, opts) {
    if (type === 'warsha:pair-deeplink') rec.listenerAt = now();
    return add(type, fn, opts);
  };

  window.addEventListener('error', (e) => rec.errors.push({ t: now(), msg: String(e.message).slice(0, 200) }), true);
  window.addEventListener('unhandledrejection', (e) => rec.errors.push({ t: now(), msg: String(e.reason).slice(0, 200) }), true);

  const wrap = () => {
    const b = window.WarshaNative;
    if (!b) return;
    for (const name of ['getInitialPairingUri', 'loadSecret', 'saveSecret', 'deleteSecret']) {
      const orig = b[name];
      if (typeof orig !== 'function') continue;
      try {
        b[name] = function (...args) {
          const out = orig.apply(b, args);
          if (name === 'getInitialPairingUri') {
            if (!rec.selfCall) rec.appCalls.push({ t: now(), v: shape(out) });
          } else {
            rec.store.push({ t: now(), name, out: out === true ? 'true' : typeof out === 'string' ? 'string' : String(out) });
          }
          return out;
        };
        if (b[name] !== orig) rec.wrapped.push(name);
      } catch { /* a bridge method may refuse assignment; E4 covers it */ }
    }
  };

  const timer = setInterval(() => {
    try {
      const b = window.WarshaNative;
      if (!b) { rec.calls.push({ t: now(), v: 'no-bridge' }); return; }
      if (!rec.tried) { rec.tried = true; wrap(); }
      rec.selfCall = true;
      const v = b.getInitialPairingUri ? b.getInitialPairingUri() : 'no-method';
      rec.selfCall = false;
      rec.calls.push({ t: now(), v: shape(v) });
      if (typeof v === 'string' && v !== '') clearInterval(timer);
    } catch (err) { rec.calls.push({ t: now(), v: `throw:${String(err).slice(0, 120)}` }); }
  }, 200);
})()
```

Runner (holds the CDP session open — the injected script is owned by that session; `Page.reload` gives a
fresh document, which is the page half of the cold path because `pendingPairingUri` is still set in the
activity):

```bash
sock=$(adb shell cat /proc/net/unix | grep -o 'webview_devtools_remote_[0-9]*' | head -1)
adb forward --remove tcp:9333 >/dev/null 2>&1 || true
adb forward tcp:9333 "localabstract:$sock"
# the page target is the one whose url is https://appassets.androidplatform.net/index.html
path=$(node -e 'fetch("http://127.0.0.1:9333/json").then(r=>r.json()).then(l=>{const p=l.find(t=>String(t.url).includes("appassets.androidplatform.net"))||l.find(t=>t.type==="page");process.stdout.write(new URL(p.webSocketDebuggerUrl).pathname)})')
WSURL="ws://127.0.0.1:9333$path"
PROBE_OUT=target/r-ui-7b/probe-v1.jsonl node - "$WSURL" target/r-ui-7b/probe.js 30 <<'NODE'
const { readFileSync, appendFileSync } = require('node:fs');
const [wsUrl, probeFile, seconds] = process.argv.slice(2);
const source = readFileSync(probeFile, 'utf8');
const ws = new WebSocket(wsUrl);
let id = 0; const pending = new Map();
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id; pending.set(n, { resolve, reject });
  ws.send(JSON.stringify({ id: n, method, params }));
});
ws.addEventListener('message', (event) => {
  const m = JSON.parse(event.data); const p = pending.get(m.id);
  if (!p) return; pending.delete(m.id);
  m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result ?? {});
});
ws.addEventListener('open', async () => {
  await call('Page.enable');
  await call('Page.addScriptToEvaluateOnNewDocument', { source });
  await call('Page.reload', { ignoreCache: true });
  const deadline = Date.now() + Number(seconds) * 1000;
  while (Date.now() < deadline) {
    const r = await call('Runtime.evaluate', {
      expression: 'JSON.stringify(window.__warshaProbe ?? null)', returnByValue: true,
    });
    appendFileSync(process.env.PROBE_OUT, `${Date.now()} ${r.result ? r.result.value : 'null'}\n`);
    await new Promise((r2) => setTimeout(r2, 500));
  }
  ws.close(); process.exit(0);
});
ws.addEventListener('error', (e) => { console.error('cdp error'); process.exit(1); });
NODE
```

Fallback if the WebView's DevTools channel refuses `Page.addScriptToEvaluateOnNewDocument`: `Page.enable`
then `Page.navigate` to the same `START_PAGE` and `Runtime.evaluate` the probe on `Page.loadEventFired` — it
lands after the app's mount, so P-b/P-c lose the document-start edge and the run is recorded as
`mode: "late-probe"` instead of being reported as if it had the edge.

### E3 — replay the device's own link after mount (decisive for Q2)

```js
// via Runtime.evaluate; returns only a length, never the URI
(() => {
  const b = window.WarshaNative;
  if (!b || typeof b.getInitialPairingUri !== 'function') return { ok: false, why: 'no bridge' };
  const link = b.getInitialPairingUri();
  if (typeof link !== 'string' || link === '') return { ok: false, why: 'no link' };
  window.dispatchEvent(new CustomEvent('warsha:pair-deeplink', { detail: link }));
  return { ok: true, len: link.length };
})()
```

Then read `PAIRED_STATE_JS`'s two facts through the same socket and `window.__warshaProbe.store`. If the
bench pairs here, the page/transport half works and the defect is the shell→page handoff (H1/H2). If it does
not, the defect is in adoption (H3) or the two are additive (V4 below).

### E4 — the software-Keystore control (the artifact experiment that *is* runnable)

Same APK, same device, same pairing path, same page — only the secret store is replaced, in the page, before
any script runs. `localStorage` is the backing store because it survives a reload and a process restart on
this origin (`setDomStorageEnabled(true)`, `MainActivity.java:88`), which is exactly the persistence the
native vault cannot provide while the Keystore refuses writes. This is the device-side twin of that lane's
`variants.cjs`, and it is plaintext: throwaway AVD only.

```js
(() => {
  const real = window.WarshaNative;
  if (!real) return;
  const NS = 'warsha-probe-store:';
  const stub = {
    getInitialPairingUri: () => real.getInitialPairingUri.call(real),
    getAppRole: () => (real.getAppRole ? real.getAppRole.call(real) : 'remote_companion'),
    getNativeInfo: () => (real.getNativeInfo ? real.getNativeInfo.call(real) : '{}'),
    loadSecret: (k) => localStorage.getItem(NS + k),
    saveSecret: (k, v) => { try { localStorage.setItem(NS + k, v); return true; } catch { return false; } },
    deleteSecret: (k) => { try { localStorage.removeItem(NS + k); return true; } catch { return false; } },
  };
  try {
    Object.defineProperty(window, 'WarshaNative', { configurable: true, enumerable: true, writable: true, value: stub });
  } catch {
    try { window.WarshaNative = stub; } catch { return; }
  }
  window.__warshaProbeStore = window.WarshaNative === stub ? 'stub' : 'real';
})()
```

Run it through the same §E2 runner (install as the document-start source, `Page.reload`), then repeat the
S2 cold sequence and E3. `window.__warshaProbeStore` must read `stub` for the run to count; if P-a reported
`configurable: false, writable: false`, this control needs a product-side equivalent and is marked
**infeasible on this base** rather than worked around.

The hardware-backed leg the owner asked for: with a physical device attached
(`adb devices` non-empty), the same E1–E4 sequence runs unchanged against real hardware, and
`KeyInfo.isInsideSecureHardware()`/`getSecurityLevel()`/attestation may only be read by a diagnostic build
(§E5, gated). With no device attached on this host, that leg is recorded as **not run — no hardware on this
host**, not as passed.

### E5 — D1, the diagnostic build (gated; the only way to settle H2's message and the exception site)

Minimal, behaviour-neutral, **not authorized by this design**:

```java
// MainActivity.logBridgeError  — keep the message, add the throwable (no values, no keys, no URIs)
Log.w(TAG, "native bridge operation failed: " + operation, error);

// MainActivity.initialPairingUri — record whether the bridge thread sees the field
Log.d(TAG, "initialPairingUri on " + Thread.currentThread().getName()
        + ": " + (pendingPairingUri == null ? "null" : "set"));
```

It pins (i) which of `WarshaNative.java:98` / `:244` throws and with what message, and (ii) whether the mount
read is stale. It changes no behaviour and no contract, and it is still a product edit: it waits for Gate B.

## Pre-registered criteria: artifact vs defect

These are fixed **before** any experiment runs, so the result cannot be chosen after the fact. Each row is
keyed on observations from §E2–§E4 plus the pid timeline.

| # | link at mount (P-b) / app's own call (P-d) | replay pairs (E3) | software store changes the outcome (E4) | Verdict |
| --- | --- | --- | --- | --- |
| **V1** | no link, or the app never calls | **yes** | no | **Handoff defect (H1/H2).** The shell loses the link on the cold path; the page can adopt it. The Keystore is an artifact. |
| **V2** | link present | **no** | no | **Adoption defect (H3/H4).** The page had the link and could not use it. The Keystore is an artifact. |
| **V3** | either | not decisive | **yes** (native cold fails, stub cold pairs) | **Coupling (H5).** The refusal is load-bearing across a restart; artifact and defect must be fixed together. |
| **V4** | no link | **no** | no | **Two walls (H1/H2 + H3/H4).** The shell loses the link *and* the page cannot adopt it; one packet each. The Keystore is an artifact. |

**Artifact is established** (regardless of which defect row fires) when all three hold:
`E4` changes nothing about the outcome, the only Keystore observation is a caught `false` on `saveSecret`
(`WarshaNative.java:111-113`, probe `store` shows `saveSecret: false` and no outstanding call), and the pid
timeline shows the app process survives the whole S2 window — i.e. nothing re-reads persisted state.
Then the Keystore refusal is recorded as an **environment artifact, not fixed by the pairing packet**, and
the null-vs-undefined read contract (`loadSecret` answering `undefined` for a missing key,
`R-UI-7-report.md:190-192`) and the message-less log line stay as named follow-ups.

**Defect is established** when the failure is visible in an adoption/handoff observation above **with the
software store in place** — i.e. it reproduces without the Keystore in the picture.

**No claim may be made from the current S2 gate alone**, for three measured reasons: it conflates adoption
with bench rendering, its bench clause can be satisfied by an `UnpairedScreen` placeholder, and it has no
bridge or Keystore log key. Any future "S2 green" claim must be accompanied by the probe evidence.

## SIGN-OFF GATE

Nothing below runs until the owner signs. This design authorizes no product change; the branch it ships on
contains this file and nothing else.

**Gate A — sign the design (authorizes read-only experiments, not code).**

- [ ] The owner accepts the framing: the Keystore refusal is a *candidate artifact*, the handoff/adoption
      failure is the *candidate defect*, and `E4` — not an AVD comparison — is the discriminator.
- [ ] The owner accepts the base-tree facts in §"Measured at the base", including that the exception's
      message and stack are unavailable without a diagnostic build, and that the two AVDs share one system
      image so the requested AVD-vs-AVD attestation comparison cannot be run as written.
- [ ] The owner accepts the pre-registered verdict table (V1–V4) as the decision rule.
- [ ] On Gate A, `E0`, `E1`, `E2`, `E3` and `E4` may be run: device measurements, no edit to `apps/`,
      `crates/`, `packages/` or `scripts/`, evidence under `target/r-ui-7b/`.

**Gate B — sign the evidence (authorizes a fix packet).**

- [ ] The owner reviews `target/r-ui-7b/probe-v1.jsonl`, the cold-path trace, the E4 run and the verdict.
- [ ] The owner picks the follow-up packet: **F1/F2/F3** (handoff, below) or an adoption packet, and whether
      the Keystore artifact gets its own packet (recommended: yes, separately — it is a device/environment
      issue, not a pairing one).
- [ ] Only then may `E5` (diagnostic build) or any fix be implemented, under a new frozen packet with its
      own allowed-files list and gates.

**Until Gate B is signed, implementation of any fix is out of scope** — including `E5`, the smoke-script
S2 tightening, and any `MainActivity`/`WarshaNative`/`App.tsx`/`session.ts` edit.

## Candidate fix shapes (unauthorized; for the Gate B decision, not to be implemented now)

| Shape | Smallest change | What it fixes / does not fix | Risk |
| --- | --- | --- | --- |
| **F1** deliver on page-finished and verify delivery | `MainActivity`: a `WebViewClient.onPageFinished` re-dispatch, and drop `deliveredPairingUris.add` unless the `evaluateJavascript` callback reports a result | Fixes H1; leaves H2 and H3 alone | re-dispatch must stay idempotent (`pair()` is), and must not re-fire on every resume |
| **F2** a consume-once bridge method | `WarshaNative.consumeInitialPairingUri()` (returns the URI once, then clears it) + one page-side call | Fixes H1 and H2 by making the handoff pull-based and single-owner; needs a page change and a contract test | a missed consume loses the link until the next launch — needs a non-destructive read alongside |
| **F3** publish the field safely | `volatile` on `pendingPairingUri` (or a synchronized pair of accessors) | Fixes H2 only; one line | none material; will not move S2 on its own if H1 dominates |
| **K0** no Keystore fix in this lane | record the artifact; log the throwable (`E5`) as a separate diagnostic packet | The vault stays unpersisted on this emulator image, so pairing would not survive a restart there | the real device is expected to be fine; the emulator remains a partial device acceptance surface |

## Out of scope (this packet)

Admitting `null` or any new origin; CSP edit; `network_security_config.xml`; `androidx.*`; Gradle changes;
`scripts/android-smoke.sh` edits; anything under `apps/`, `crates/`, `packages/`; visual baselines (OD1);
solving the exception's root cause; promising a hardware-backed run without hardware.

## Risks and honest limits

- **The probe cannot instrument the true cold mount.** `Page.addScriptToEvaluateOnNewDocument` needs a live
  CDP target, which does not exist before the process starts. `E2`'s `Page.reload` reproduces the *page*
  half of the cold path (activity alive, `pendingPairingUri` set) but not the *process* half. H2 can be
  narrowed by the probe and only settled by `E5`.
- **Monkey-patching a Java bridge object may be refused.** P-a reports it up front; if the object is not
  configurable/writable, E4 is marked infeasible on this base rather than approximated.
- **The replay is not the launch.** `E3` proves the page *can* adopt that link now; it does not prove the
  cold path delivers it. It is a separator, not a fix.
- **One image, one Keystore.** Everything measured on this host describes `android-35/google_apis_playstore`
  software KeyMint; conclusions do not transfer to a TEE-backed phone without the physical-device leg.
- **Athar's DevTools is flaky** (`R-UI-5-report.md:39-45`, `R-UI-7-report.md:153-157`): an `ERR` there is a
  harness non-answer, not evidence. Re-run once and keep both runs.

## Evidence layout (target/r-ui-7b/, gitignored)

`probe.js`, `probe-v1.jsonl` (P-a..P-e samples), `probe-store.jsonl` (E4), `cold-pid.txt` (0.5 s pid
samples), `s2-state.txt` (`PAIRED_STATE_JS` samples), `logcat.txt` / `logcat-keystore.txt` (filtered for
`WarshaMainActivity|keystore|KeyMint|Conscrypt`), `daemon.log`, `emulator.log`, and a `verdict.md` that maps
the run to one row of §"Pre-registered criteria" verbatim. No token, no URI and no ciphertext is ever
written; the probe records lengths only.
