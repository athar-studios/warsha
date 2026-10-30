# Work Protection

<div dir="rtl" lang="ar">

## حماية العمل

الوكيل يكتب ملفات كثيرة بسرعة، والخطأ في ملف واحد قد يكلّف جلسة كاملة. الحماية هنا
تجعل كل تعديل قابلًا للتراجع، وكل عمل خطير معزولًا، وكل كتابة تحتاج قراءةً سابقة.

- **لقطة قبل كل تعديل** — تُؤخذ نسخة من محتوى الملفات قبل أن يكتب الوكيل، ومعها زر
  «استعادة اللقطة» يرجع الملفات كما كانت في ثانية واحدة.
- **قرار لكل مقطع فرق** — في عرض التشغيل يمكنك الاحتفاظ بمقطع (hunk) من التغيير
  ورفض آخر، عبر عارض الفروق الموجود نفسه؛ لا محرّك فروق جديد.
- **مكدّس تراجع للعمليات** — كل عملية ذكاء اصطناعي تُسجّل في مكدّس تراجع محدود
  (50 مدخلًا) خاص بالتشغيل، ويُفرَّغ عند الموافقة على البوابة.
- **عزل بـ worktree** — المهام الخطرة تُنفَّذ في نسخة عمل git منفصلة، ولا تُدمج إلا
  عند البوابة C.
- **اقرأ قبل أن تكتب** — لا يستطيع الوكيل أن يستبدل ملفًا لم يقرأه في التشغيل الحالي.
- **أنماط إذن لكل جلسة** — «اسأل دائماً» أو «اسأل عند الخطر» أو «تلقائي داخل المشروع».

### أنماط الإذن

| النمط                       | متى يسأل الوكيل المالك                            |
| --------------------------- | ------------------------------------------------- |
| `ask_always`                | قبل كل تعديل يكتبه الوكيل                         |
| `ask_for_risky` (الافتراضي) | الكتابة خارج المشروع، الوصول إلى الشبكة، والإنفاق |
| `auto_inside_project`       | لا يسأل ما دام داخل مجلد المشروع                  |

النمط يظهر كشريحة (chip) في شريط الحالة، والضغط عليه ينقله إلى النمط التالي.

</div>

## English

Every agent edit in Warsha is reversible, isolated when risky, and preceded by a read. The
policy lives in `crates/warsha-pipeline/src/work_protection.rs`; the run view reuses the existing
diff viewer for per-hunk decisions, so no second diff engine exists.

### Snapshot and restore

A snapshot is the full text of the files an agent is about to touch, taken before the edit:

```rust,ignore
pub struct Snapshot {
    pub id: String,
    pub run_id: String,
    pub created_at: u64,
    pub files: Vec<SnapshotFile>, // { path, content }
}
```

The `SnapshotStore` trait is the persistence seam: `create` stores a snapshot, `restore` returns
the contents to put back, and `list` returns one run's snapshots oldest first. The shipped
`InMemorySnapshotStore` is both the default for a run and the mock for tests; a git-backed store
(stash or checkpoint commit) implements the same three methods without changing callers.

Restore is one click: **Restore snapshot** is enabled only when the run has a snapshot, and it
restores the whole snapshot. Per-file and per-hunk control is the diff card below.

### Per-hunk keep and revert

The run view shows the agent's diff through the existing diff viewer. Each hunk gets
**Keep** and **Revert**; reverting a hunk restores that range from the snapshot instead of
rewriting the file wholesale. Rejected work therefore restores the snapshot rather than leaving a
half-applied edit behind.

### Undo stack

AI operations push an `UndoEntry { snapshot_id, description }` onto a per-run `UndoStack`:

- last in, first out — **Undo** takes the newest entry;
- capped at 50 entries (`MAX_UNDO_ENTRIES`), the oldest falls off first;
- cleared when the run is approved, and never shared between runs.

The stack itself is in memory, but the entries are serialisable and the snapshots they point at
are recorded in the run's event store, so the history survives a crash even though the in-memory
stack does not.

### Worktree isolation

When `worktree_isolation` is on, a risky task runs in a separate `git worktree` checkout. The
agent may edit, test and break things there freely; nothing reaches the project's working tree
until Gate C approves the merge. A rejected run simply discards the worktree.

### Read before write

`ReadBeforeWriteGuard` refuses an overwrite of a file the agent has not read in the current run:

```rust,ignore
let mut guard = ReadBeforeWriteGuard::new(true);
guard.may_write("src/main.rs");   // false — not read yet
guard.record_read("src/main.rs");
guard.may_write("./src/main.rs"); // true — same path, normalised
```

The tool layer calls `record_read` on every read and `may_write` before every write. When the
policy sets `read_before_write: false`, the guard allows everything, so the check stays in the
tool layer unconditionally. `./src/main.rs` and `src/main.rs` are treated as the same file.

### Permission modes

| Mode                      | Asks the owner                                            |
| ------------------------- | --------------------------------------------------------- |
| `ask_always`              | before every agent edit                                   |
| `ask_for_risky` (default) | writes outside the project, network access, spend         |
| `auto_inside_project`     | never, while the agent stays inside the project directory |

`WorkProtectionPolicy` carries the mode with the other switches, and its default is the shipped
one: ask for risky work, snapshot before edits, no worktree isolation unless enabled, and
read-before-write enforced.

```rust,ignore
pub struct WorkProtectionPolicy {
    pub mode: PermissionMode,
    pub snapshot_before_edit: bool, // true
    pub worktree_isolation: bool,   // false
    pub read_before_write: bool,    // true
}
```

The mode is persisted per project and shown as a chip in the status strip
(`apps/desktop/src/components/PermissionModeChip.tsx`); clicking it cycles to the next mode. The
chip and the restore button (`SnapshotRestoreButton.tsx`) are the two UI pieces, and they take
their labels from the i18n catalogs with a local fallback.

### What is not here yet

Git wiring for the snapshot store and the worktree lifecycle is not implemented in this
milestone: the traits and the in-memory implementations are the contract, so a git-backed store
plugs in behind them. Per-hunk keep/revert leans on the existing diff viewer for the same reason.
