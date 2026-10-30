# Continue on Server

<div dir="rtl" lang="ar">

## المتابعة على الخادم

أحيانًا يجب أن يُغلق الحاسوب قبل أن تنتهي المهمة. هذه الميزة تنقل التشغيل من
جهازك إلى خادم `warshad` بعيد، فيكمل هناك، ثم ترجع التغييرات ملفًا ملفًا مع
نسخة احتياطية — وقرارك أنت عند أي تعارض.

- **التسليم** — الحزمة تحمل التشغيل وملفاته كاملة، ولكل ملف بصمته (checksum)
  التي تُتحقَّق قبل الكتابة. يمكنك بعدها إغلاق الحاسوب: التشغيل صار على الخادم.
- **المتابعة من الهاتف** — يعرض تطبيق الهاتف التشغيل البعيد نفسه، وتصل رسائل
  المحادثة وقرارات البوابات عبر القناة المشفّرة القائمة من M6.
- **المراجعة والتطبيق** — لوحة تعرض كل ملف تغيّر مع فرقه، وأزرار «تطبيق الكل» و
  «تطبيق المحدد». لا يُكتب شيء قبل ضغط الزر، ولا تُكتب فوق ملف إلا بعد حفظ نسخة
  احتياطية.
- **التعارض ليس صامتًا** — إذا تغيّر الملف على الجهاز وعلى الخادم معًا، يُسجَّل
  التعارض ببصمتيه. القاعدة الافتراضية «ملفك يفوز»، وفي حالة «الخادم يفوز» يُرفع
  التعارض كبوابة تحتاج توقيعك بدل الكتابة الصامتة.

### الحالات

`idle` (محلي) ← `preparing` ← `handed_off` ← `applying` ← `applied`، ومن أي خطوة
إلى `failed` مع السبب. الفشل ليس طريقًا مسدودًا: `failed` يعود إلى `preparing`
عند إعادة المحاولة.

### اتجاه الواجهة

النافذة واللوحة تأخذان `dir` من `useDirection()` وتستخدمان خصائص CSS منطقية
(`paddingInline`، `paddingBlock`). عنوان الخادم والمسارات والفرق تبقى `dir="ltr"`
مع `unicodeBidi: 'isolate'` لأنها تُقرأ من اليسار إلى اليمين في اللغتين.

</div>

## English

"Continue on server" is one Rust module and two desktop components. LingCode-inspired ideas
only: no code, text or asset was copied from it. No dependency was added — the checksum is
hand-rolled because this crate has no digest library and the milestone adds no crate.

| Deliverable | Path |
| --- | --- |
| Handoff lifecycle, bundle, apply rules | `crates/warsha-pipeline/src/handoff.rs` |
| Hand off dialog | `apps/desktop/src/components/HandoffDialog.tsx` |
| Review & apply panel | `apps/desktop/src/components/ReviewApplyPanel.tsx` |
| Tests | `HandoffDialog.test.tsx`, `ReviewApplyPanel.test.tsx`, `handoff::tests` in Rust |

### Handoff state machine

```rust,ignore
pub enum HandoffState {
    Idle,
    Preparing,
    HandedOff { remote_run_id: String, remote_url: String },
    Applying,
    Applied,
    Failed(String),
}
```

`HandoffManager` owns one state and refuses an illegal step (`handoff::HandoffError::
InvalidTransition`), so `applying` cannot be reached before `handed_off` and `applied` cannot
be reached before `applying`. `begin()` is allowed from `idle` *and* from `failed`: a dropped
relay frame should be a retry, not a dead run. `fail(reason)` is reachable from every state and
replaces an earlier reason. `reset()` is explicit — nothing returns to `idle` on its own.

The serialized form is adjacently tagged, so the desktop reads one field:

```json
{ "state": "handed_off", "detail": { "remote_run_id": "remote-run-7", "remote_url": "https://warsha.example.com" } }
```

`HandoffState::label()` yields exactly the `HandoffPhase` union in `HandoffDialog.tsx`
(`idle`, `preparing`, `handed_off`, `applying`, `applied`, `failed`), so the daemon value is the
desktop value with no translation table.

### Bundle and checksums

```rust,ignore
pub struct HandoffFile { pub path: String, pub content: String, pub checksum: String }
pub struct HandoffBundle { pub run_id: String, pub files: Vec<HandoffFile> }
```

`HandoffManager::create_bundle(run_id, &[(path, content)])` captures full contents (not a diff)
and computes each checksum with `content_checksum`: 64-bit FNV-1a over the UTF-8 bytes, rendered
as 16 lowercase hex digits. It answers "did these bytes change", not "did someone forge them" —
the channel's confidentiality and authentication stay the existing E2E pairing channel's job.

An apply verifies every checksum before it decides anything, and a single mismatch refuses the
whole bundle:

```rust,ignore
pub enum HandoffError {
    ChecksumMismatch { path: String },
    InvalidBundle(String),
    InvalidTransition { from: String, to: String },
}
```

The bundle is applied as one unit on purpose: a half-written tree is worse than a refused
bundle. `InvalidBundle` covers a missing run id, an empty path and a path that appears twice
(`./src/main.rs` and `src/main.rs` count as the same file).

### Review and apply

```rust,ignore
pub struct ApplyOptions { pub owner_wins: bool, pub selected: Option<Vec<String>> }
pub struct ApplyResult {
    pub applied: Vec<String>,
    pub conflicts: Vec<Conflict>,
    pub backups: Vec<String>,
    pub resolved: Vec<String>,
}
pub struct Conflict { pub path: String, pub local_checksum: String, pub remote_checksum: String }
```

`apply_bundle(&bundle, &[(local_path, local_content)], &options)` is a **dry run**: it writes
nothing and returns what an apply would do. Per bundled path:

| Local file | Decision |
| --- | --- |
| absent | `applied` — nothing to overwrite, nothing to back up |
| same content as the bundle | `applied` — already what the remote produced, no backup |
| different content | a `Conflict`, plus `backups` for that path; then `owner_wins` decides |

`owner_wins: true` (the default) keeps the local file and records the path in `resolved`:
the remote change is dropped *and said so*, never dropped silently. `owner_wins: false` writes
the remote content after backing the local one up, and leaves the conflict in `conflicts`.

`selected: None` applies the whole bundle; `selected: Some(paths)` applies only those, which is
exactly what the panel's "Apply selected" sends. Output order is bundle order, not selection
order.

`ApplyResult::requires_gate()` is the AC's "a conflict is surfaced as a gate": it is true when a
conflict was not settled by the rule — that is, a remote-wins overwrite of a local edit. An
owner-wins conflict is settled and recorded, so it needs no gate but still appears in
`conflicts`. `backup_bundle_name(run_id)` gives the notice and the backup one shared string
(`warsha-backup-<run_id>`).

Nothing here touches the filesystem, the network or the event store: the caller writes the
files, takes the backup and appends the gate event. That keeps the conflict rules testable
without a temp directory, and keeps an apply a dry run until the owner presses the button.

### Desktop components

`HandoffDialog` is a modal (`role="dialog"`, `aria-modal`, a labelled title) with the remote URL
input, the hand-off button and a `role="status"` line for the phase. `isRemoteUrl` accepts only
`http`/`https` with a host and no whitespace, so the button stays off for a bare host or another
scheme; the hint explains which. A URL reads left-to-right in both languages, so the input is
pinned to `dir="ltr"`. The dialog reads no credential and logs nothing — a pairing secret
belongs to the existing device-pairing handshake, never to this URL.

`ReviewApplyPanel` renders one row per changed file: a checkbox, the path (`dir="ltr"`), a `new`
badge when the local side has no such file, a `conflict` badge, and the line diff. `diffLines`
trims the common head and tail into context lines and marks the middle removed-then-added; it is
a prefix/suffix trim, not a full LCS, because the run view keeps the real diff viewer and no
second diff engine is introduced. A row renders at most `MAX_DIFF_LINES` lines and then says how
many it did not show. Files that apply cleanly start selected and a conflict starts unchecked —
a conflict is a decision, so it should not ride along with "Apply selected" by default.

"Apply all" sends every path; "Apply selected" sends the checked ones in file order and stays
off while nothing is checked. The backup notice names the bundle and the run, and a policy line
states the conflict rule in force (owner-wins or remote-wins).

Both components call `t()` with ar/en fallbacks for every string, exactly as the M14a/M14b/M5a/M5b
components do: a catalog entry added later takes precedence automatically.

### RTL

Both components take `dir` from `useDirection()` and use logical CSS properties
(`paddingInline`, `paddingBlock`) instead of `left`/`right`. Paths, URLs and diffs stay `dir="ltr"`
with `unicodeBidi: 'isolate'`, so an LTR run inside an RTL layout cannot reorder the sentence
around it.

### What is not here yet

- **No remote RPC.** `warshad` has no handoff method, so `onHandOff(url)` and `onApply(paths)`
  are seams and `phase` is the caller's to supply. Nothing is sent anywhere.
- **No relay or PWA change.** The phone half rides on the existing M6 encrypted channel and the
  PWA screens are outside this batch's files; no PWA screen shows a handoff yet.
- **No file writer.** `apply_bundle` decides; the daemon-side code that writes the files and
  creates the archive behind `backup_bundle_name` does not exist here.
- **No gate event.** `requires_gate()` is the decision, not the emission: appending a
  `GateDecision` for an unresolved conflict is the caller's job.
- **Not mounted in a screen.** The allowed file scope is the two components, their tests and
  this chapter, so `App.tsx` and the run view do not render them (same precedent as M14a,
  M14b, M5a and M5b).
