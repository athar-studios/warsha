# Agent Workflow and Context

<div dir="rtl" lang="ar">

## سير عمل الوكيل والسياق

هذا الفصل يوثّق الطبقة التي يقف عليها الوكيل: كيف ينتقل من التخطيط إلى
التنفيذ، وكيف يعلن ما سيفعله، وكيف يسأل صاحبه، وكيف يلحق السياق بسؤاله،
وكيف يحافظ على الميزانية حين يكبر الحديث.

- **وضعان فقط**: `plan` و`agent`. التشغيل يبدأ في `plan`، والوكيل يقرأ ويقترح
  ولا يعدّل. الانتقال إلى `agent` يحتاج اسم من وافق؛ أما العودة إلى `plan`
  فمسموحة دائمًا وبنقرة واحدة.
- **قائمة مهام** يعلنها الوكيل قبل أن يبدأ، لكل بند معرّف ووصف وحالة.
- **`ask_user`** سؤال يوقف التشغيل حتى يجيب المالك، و**`send_message`** ملاحظة
  تقدّم لا توقف شيئًا.
- **الإشارات** `@file` و`@folder` و`@codebase` و`@terminal` و`@web` و`@docs`
  تُقرأ من نص الطلب وتصبح مرفقات سياق.
- **أوامر الشرطة** `/skill-name`: المهارات المثبّتة تظهر في صندوق الكتابة مع
  إكمال تلقائي.
- **ضغط السياق على ثلاث مراحل**: الأحدث كما هو، وما قبله في سطر ملخّص، والأقدم
  يُسقط إذا ضاقت الميزانية.
- **ضغط مخرجات الأدوات**: أول الأسطر وآخرها يبقيان، والوسط يُستبدل بسطر واحد
  يذكر عدد ما حُذف، مع تقدير ما وفّره ذلك من رموز.

القاعدة التي لا تتغيّر: الوكيل في وضع `plan` لا يكتب ملفًا، والانتقال إلى
`agent` قرار مالك لا قرار وكيل. لا شيء في هذه الوحدة يفتح اتصالًا ولا يستدعي
مزوّدًا.

</div>

## English

"Agent workflow and context" is one Rust module, three desktop components and the
tests that cover both. LingCode-inspired ideas only: no code, text or asset was
copied from it. No dependency was added, no `Cargo.toml` edited, no
`.github/workflows/**` change and no i18n catalog entry.

| Deliverable                                                                                 | Path                                                                                                               |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Modes, todos, `ask_user`, `send_message`, mentions, slash commands, compaction, compression | `crates/warsha-pipeline/src/agent_workflow.rs`                                                                     |
| Plan/Agent badge                                                                            | `apps/desktop/src/components/PlanModeBadge.tsx`                                                                    |
| Mention picker                                                                              | `apps/desktop/src/components/MentionPicker.tsx`                                                                    |
| Slash command picker                                                                        | `apps/desktop/src/components/SlashCommandPicker.tsx`                                                               |
| Tests                                                                                       | `agent_workflow::tests` in Rust, `PlanModeBadge.test.tsx`, `MentionPicker.test.tsx`, `SlashCommandPicker.test.tsx` |

### Plan mode → Agent mode

```rust,ignore
pub enum AgentMode {
    Plan,
    Agent,
}

pub struct ModeTransition {
    pub from: AgentMode,
    pub to: AgentMode,
    pub approved_by: String,
    pub approved_at: u64,
}

pub struct ModeManager {
    pub current: AgentMode,
    pub history: Vec<ModeTransition>,
}
```

`ModeManager::request_transition(to, approved_by)` is the only way the mode
changes, and it enforces three rules:

| From    | To            | `approved_by`             | Result                                                                 |
| ------- | ------------- | ------------------------- | ---------------------------------------------------------------------- |
| `plan`  | `agent`       | a name                    | accepted, recorded, `current` becomes `agent`                          |
| `plan`  | `agent`       | blank                     | `AgentWorkflowError::ApprovalRequired`, nothing changes                |
| `agent` | `plan`        | anything, including blank | accepted — the read-only direction is always allowed                   |
| any     | the same mode | —                         | `AgentWorkflowError::SameMode`, so the history is a record of switches |

The blank-name refusal is the AC's "Plan → Agent requires an explicit approval":
a mode switch with nobody's name on it never happens, and every accepted switch
lands in `history` with the approver and a Unix timestamp, so the audit trail can
be replayed from the manager alone. `can_edit()` is the one predicate the tool
layer asks before it writes anything.

`PlanModeBadge` renders the current mode as a pill — indigo for Plan, the
single accent `#FFD60A` on `#0E0E0E` for Agent — with `aria-pressed` telling a
screen reader which side it is on, and calls `onToggle(nextAgentMode(mode))` on
click. The badge never applies the switch itself: granting Agent mode is an owner
approval (an approval card, the gates inbox), not a click on a badge, and keeping
that call in the caller is what stops the component from becoming the thing that
grants edit rights.

### Todo tool

```rust,ignore
pub enum TodoStatus {
    Pending,
    InProgress,
    Done,
    Cancelled,
}

pub struct TodoItem {
    pub id: String,
    pub description: String,
    pub status: TodoStatus,
}

pub struct TodoList {
    pub items: Vec<TodoItem>,
}
```

`TodoList::add` rejects a blank id, a blank description and a duplicate id;
`update` moves one item and returns it; `remove` returns the removed item and
fails on an unknown id. `list_pending()` returns the items that still need work —
`Pending` _and_ `InProgress`, because that is the run's remaining work — and
`is_complete()` is its negation. `Cancelled` is deliberately not `Done`: dropping
a task and finishing it are different facts, and the list keeps them apart.

### `ask_user` and `send_message`

```rust,ignore
pub struct AskUserRequest {
    pub id: String,
    pub question: String,
    pub blocking: bool,
    pub answer: Option<String>,
}

pub struct Message {
    pub id: String,
    pub from: String,
    pub to: String,
    pub content: String,
    pub sent_at: u64,
    pub read: bool,
}
```

`AskUserQueue` is the blocking contract. `enqueue` refuses a blank question and a
duplicate id; `answer` refuses a second answer and a blank one (an empty string is
not an answer, and silently accepting it would unblock the run with nothing);
`pending()` lists the unanswered questions in queue order. `blocks_run()` is true
while any **blocking** question is unanswered, and `blocking()` names the first
one — that is the AC's "`ask_user` blocks the run until answered", expressed as
one predicate the agent loop checks between steps. A non-blocking question is a
note the agent may continue without.

`MessageBus::send` is the non-blocking path: progress notes carry a sender, a
recipient, the content and a timestamp, never an approval. `read` marks one
message read (idempotent — a second read is not an error), `unread_count()` is the
badge number, and `unread_for(agent)` answers the same question for one recipient.

### Mentions

```rust,ignore
pub enum MentionKind {
    File,
    Folder,
    Codebase,
    Terminal,
    Web,
    Docs,
}

pub struct Mention {
    pub kind: MentionKind,
    pub target: String,
}

MentionParser::parse("@file src/main.rs, @codebase and @docs quickstart.md");
```

`MentionParser::parse` is a hand-rolled scan, not a regex: the module adds no
dependency. Its rules are small enough to state in full, and each one is a test:

- the kind is one of the six above, compared case-insensitively;
- `@file:src/a.rs` and `@file src/a.rs` produce the same mention;
- the target is one whitespace-delimited token, so a path containing a space is
  not supported — mention the folder instead;
- trailing punctuation (`,`, `.`, `)`, a closing backtick, …) is trimmed;
- a bare `@codebase` means the whole codebase and gets an empty target;
- the `@` must _begin_ a token, so `dev@example.com` stays an address;
- an unknown kind (`@nobody`) and a kind with no target (`@file` at the end of a
  line) are skipped, not errors — a half-typed mention is the normal state of a
  composer;
- the same kind and target twice is one attachment, not two.

`Mention::rendered()` gives the composer form back: `@file src/main.rs`, and a
bare `@codebase` with no trailing space. `MentionPicker` lists the six kinds,
`filterMentionKinds` narrows them by prefix (a leading `@` is accepted, so the raw
fragment can be passed straight through), and a click hands the kind back —
inserting the text and attaching the file contents is the caller's job.

### Slash commands

```rust,ignore
pub struct SlashCommand {
    pub name: String,
    pub description: String,
}
```

`SlashCommandRegistry` is what the project's installed skills become:
`register` rejects a blank name, a name containing whitespace, a blank
description and a duplicate name (compared without the leading `/`,
case-insensitively); `lookup` accepts `/review` and `review` alike; `list` is
sorted by name; `matching(prefix)` is the autocomplete — prefix, not substring,
so `re` offers `/review` and `/refactor` but `/preview` stays out of the way.

`SlashCommandPicker` mirrors the same rule in TypeScript
(`filterSlashCommands`), sorts by the bare name so the `/` prefix does not decide
the order, and returns the caller's name unchanged.

### Context compaction

```rust,ignore
ContextCompactor::compact(&messages, 8_000);
```

Three stages in one function, decided by an estimated token budget
(`characters / 4`, `ContextCompactor::estimate_tokens` — an estimate, because
`warsha-pipeline` has no tokenizer and this milestone adds none):

1. **recent verbatim** — the newest messages are kept word for word, newest
   first, until about three quarters of the budget is used;
2. **summarized** — everything older is replaced by one marker line naming how
   many messages and how many characters were folded away. It is a marker, not a
   model-written summary: no provider is called, so compaction costs zero tokens
   and behaves the same every time;
3. **archived** — if even the marker does not fit, it is dropped and the oldest
   context goes with it. The newest message is never split, so it survives any
   budget, including zero.

The quarter reserved for the marker is why the kept messages do not get evicted
by the very line that is meant to represent them.

### Output compression

```rust,ignore
pub struct CompressedOutput {
    pub text: String,
    pub original_lines: usize,
    pub compressed_lines: usize,
    pub saved_tokens_estimate: usize,
}
```

`OutputCompressor::compress(output, max_lines)` keeps the head and the tail — the
first lines of a build log say what was attempted, the last ones say what failed
— and replaces the middle with `[… N lines omitted …]`. The ceiling is a line
count, not a byte count, because one very long line is still one useful fact.
`max_lines` of 3 or more yields exactly that many lines;
`1` or `2` keeps the leading lines alone (there is no room for a head, a tail and
a marker); `0` returns an empty text and counts the whole input as saved. The
`saved_tokens_estimate` is what a cost view adds up: an estimate, labelled as
such, because there is no tokenizer behind it.

### Direction and RTL

All three components take `dir` from `useDirection()` and use logical CSS
properties (`paddingInline`, `paddingBlock`, `textAlign: 'start'`). The verbatim
tokens — `@file`, `/review`, `[8,000]`-style numbers — stay `dir="ltr"` with
`unicodeBidi: 'isolate'`, so they cannot mirror inside an Arabic row while the
label next to them follows the locale.

Every string goes through `t('agent_workflow.*')` with an ar/en fallback table,
exactly as the earlier workflow components do: the catalog does not carry these
keys yet, so the fallback is what renders, and a later catalog entry takes
precedence automatically.

### What is not here yet

- **No agent loop.** Nothing calls `ModeManager`, `TodoList`, `AskUserQueue`,
  `MessageBus`, `MentionParser`, `SlashCommandRegistry`, `ContextCompactor` or
  `OutputCompressor` from a run yet: `warshad` has no `agent_workflow.*` RPC and
  the tool layer that would call them does not exist in this repository.
- **No attachment resolution.** `Mention` carries the target string; reading the
  file, walking the folder or summarising the codebase is the caller's job, so
  "mentions attach real file contents" stays open.
- **No prompt caching.** The compaction stage is local and the module never talks
  to a provider, so provider-side prompt caching is not wired here.
- **No compression of live output.** `OutputCompressor` is a pure function over a
  finished string; the terminal pane does not call it yet.
- **The three components are not mounted.** The allowed file scope is the
  components, their tests and this chapter, so `App.tsx`, `RunView` and the
  composer are untouched and each component takes its state and its callbacks
  from the caller (same precedent as M14a/M14b/M5a/M5b/M6a/M8b/M17).
- **RTK is not used.** The AC allows an existing open-source compressor if its
  license permits; this milestone uses head/tail truncation plus the token
  estimate instead of adding the dependency and its license.
