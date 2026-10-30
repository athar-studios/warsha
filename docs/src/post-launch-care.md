# Post-launch Care

<div dir="rtl" lang="ar">

## العناية بعد الإطلاق

ما بعد `v0.1.0` ليس نهاية العمل: هناك أعطال تحدث، وتقييمات تصل، وسؤال يومي
«ماذا حدث اليوم؟»، وطلبات تغيير يصفها المالك بكلماته. هذا الفصل يوثّق الطبقة
التي تمسك هذه الأربعة، وحدودها.

- **تقارير الأعطال** — تُسجَّل محليًا أولًا: الرسالة، والتتبّع إن سُمح به، ومعرّف
  التشغيل، ووقت الحدوث. لا تُرسل شيئًا من تلقائها، ولا تحمل بيانات شخصية ولا
  شيفرة مصدرية. الإرسال اختياري بمفتاح إيقاف، والشارة في الشاشة تقول ما أُرسل
  فعلًا وما لم يُرسل بعد.
- **تقييمات المتاجر** — كل تقييم يحمل وسم متجره، فيمكن سحب متجر واحد دفعة واحدة
  وإدخاله في حلقة الملاحظات. التقييم يبقى كما أرسله المتجر؛ لا يُعاد كتابته.
- **الملخّص اليومي** — رسالة واحدة بالعربية: التشغيلات المكتملة، والتكلفة، وعدد
  الأخطاء، والملاحظات الجديدة، ثم خطوات مقترحة مرتّبة بالأهم.
- **طلب تغيير بلغة عادية** — تكتب «اجعل الزر أخضر» كما تقولها، فيُفتح تشغيل جديد
  بالمخرجات نفسها وينتهي عند بوابة C وإصدار **مسوّدة**. لا شيء يُنشر تلقائيًا،
  ولا يُعلن الطلب «منتهيًا» إلا بتوقيعك.

### حالات طلب التغيّر

`pending` ← `in_progress` ← `done`، و`rejected` من أيّ من الحالتين المفتوحتين.
الطلب المرفوض يمكن إعادة فتحه إلى `pending`، و`done` حالة نهائية: إعادة فتح تغيير
منتهٍ تعني طلبًا جديدًا لا خطوة إلى الخلف.

### اتجاه الواجهة

الشاشتان تأخذان `dir` من `useDirection()` وتستخدمان خصائص CSS منطقية
(`paddingInline`، `paddingBlock`). الأوقات والنجوم ووسوم المتاجر تبقى `dir="ltr"`
مع `unicodeBidi: 'isolate'`، لأن `★★★★☆` و`2026-10-29 19:56 UTC` و
`microsoft_store` تُقرأ من اليسار إلى اليمين في اللغتين.

</div>

## English

"Post-launch care" is one Rust module and two desktop screens. LingCode-inspired
ideas only: no code, text or asset was copied from it. No dependency was added,
no `Cargo.toml`, no `.github/workflows/**` file and no i18n catalog entry changed.

| Deliverable | Path |
| --- | --- |
| Crash reports, store reviews, daily summary, change requests | `crates/warsha-pipeline/src/post_launch.rs` |
| Crash reports screen | `apps/desktop/src/screens/CrashReports.tsx` |
| Store reviews screen | `apps/desktop/src/screens/StoreReviews.tsx` |
| Tests | `post_launch::tests` in Rust, `CrashReports.test.tsx`, `StoreReviews.test.tsx` |

### Crash reports

```rust,ignore
pub struct CrashReport {
    pub id: String,
    pub run_id: String,
    pub message: String,
    pub stack_trace: Option<String>,
    pub occurred_at: u64,
    pub sent: bool,
}
```

```rust,ignore
pub trait CrashReportStore {
    fn record(&mut self, report: CrashReport) -> Result<(), PostLaunchError>;
    fn list(&self) -> Vec<CrashReport>;
    fn mark_sent(&mut self, id: &str) -> Result<CrashReport, PostLaunchError>;
}
```

`InMemoryCrashReportStore` keeps reports in arrival order, rejects a duplicate id
and a blank id or message, and `mark_sent` is idempotent: a report that already
left the machine stays `sent` instead of failing, because a retried send must not
turn a delivered report into an error. `unsent_count()` is what a collector asks
before it batches anything.

The payload is deliberately small. A report carries the message (already masked
by the guardrails layer), an optional stack trace, the run it happened in and when
— **no user identifier, no device id and no source code**. Sending is opt-in with
a kill switch, and both belong to the collector: this module never opens a socket,
so the flag the owner flips is the collector's, not a hidden default here.

### Store reviews

```rust,ignore
pub struct StoreReview {
    pub id: String,
    pub store: String,
    pub rating: u8,
    pub body: String,
    pub author: String,
    pub received_at: u64,
}
```

```rust,ignore
pub trait StoreReviewStore {
    fn record(&mut self, review: StoreReview) -> Result<(), PostLaunchError>;
    fn list(&self) -> Vec<StoreReview>;
    fn list_by_store(&self, store: &str) -> Vec<StoreReview>;
}
```

`store` is a free-form tag (`microsoft_store`, `crates_io`, …), so one list serves
every store and the feedback loop can pull one store at a time. `record` rejects a
duplicate id and a blank id or store name; a blank store would make
`list_by_store` meaningless.

`rating` is stored exactly as the store reported it. The module does **not** clamp
it, because rewriting a rating hides the data problem the feedback loop needs to
see; `StoreReview::rating_is_known()` answers whether the value is inside
`MIN_RATING`..=`MAX_RATING` (1..=5), and the desktop screen draws the clamped stars
*and* a red "Rating out of range" line for the values outside it.

### Daily summary

```rust,ignore
pub struct DailySummary {
    pub date: String,
    pub runs_completed: u32,
    pub total_cost_cents: u64,
    pub error_count: u32,
    pub new_feedback_count: u32,
    pub suggested_next_steps: Vec<String>,
}

impl DailySummaryBuilder {
    pub fn build(date: &str, runs_completed: u32, total_cost_cents: u64,
                 error_count: u32, new_feedback_count: u32) -> DailySummary;
}
```

The builder is a pure function of the counters: it reads no store and no clock, so
the daemon counts runs, cost, errors and new feedback from the sources it already
has and hands the numbers over. The suggested steps follow a fixed order — errors,
then an empty day, then new feedback, then a zero-cost day, then the gate reminder
— and the list is **never empty**: a digest that says nothing is worse than one
line saying where to look.

`DailySummaryBuilder::build` writes Arabic, the shipped language for this surface
(Arabic-first project). `DailySummaryBuilder::new(SummaryLanguage::English).summarize(…)`
produces the same numbers with English wording, so the English UI needs no second
implementation. `DailySummary::is_quiet(max_cost_cents)` is the "nothing needs you
today" test: at least one run, no errors, and spend under the owner's ceiling when
a ceiling is set.

### Plain-language change requests

```rust,ignore
pub struct PlainLanguageChangeRequest {
    pub id: String,
    pub description: String,
    pub created_at: u64,
    pub status: ChangeRequestStatus,
}

pub enum ChangeRequestStatus { Pending, InProgress, Done, Rejected }
```

The request carries the owner's own words — never a rewritten spec — and always
starts at `pending`. `ChangeRequestStatus::can_transition_to` is the whole flow:

| From | Allowed next |
| --- | --- |
| `pending` | `in_progress`, `rejected` |
| `in_progress` | `done`, `rejected` |
| `rejected` | `pending` (the owner reopens it) |
| `done` | nothing — reopening a finished change means a new request |

`ChangeRequestStore::set_status` applies that table and refuses an illegal step
with `PostLaunchError::InvalidStatusTransition { from, to }`, leaving the stored
request untouched. A request that reaches `done` has been built and is waiting at
Gate C or as a **draft** release; nothing in this module publishes, and shipping it
stays the owner's signature at Gate D.

### The two screens

`CrashReports` renders one row per report: the message, the time as
`YYYY-MM-DD HH:MM UTC`, a `sent` / `not sent` badge and, when the owner allowed it,
the stack trace in a LTR `<pre>` that scrolls. `formatCrashTime` is exported and
formats in UTC with explicit padding rather than through `toLocaleString`, because
a digest that says "19:56" without a zone describes a different crash in every
timezone — and a test must not depend on the machine's clock. A negative or
non-numeric timestamp renders as `—` instead of `Invalid Date`.

`StoreReviews` renders one row per review: the five stars, the store tag, the body
and the author. `ratingStars`, `ratingLabel`, `clampRating` and `ratingIsKnown` are
exported so the row, the `aria-label` ("4 of 5" / "4 من 5") and the tests read one
rule. The stars carry `role="img"` and that label, so a screen reader says the
rating instead of reading five glyphs.

Both screens call `t()` with ar/en fallbacks under a `post_launch.*` prefix, exactly
as the M14a/M14b/M5a/M5b/M8b screens do: a catalog entry added later takes
precedence automatically. Both take `dir` from `useDirection()`, use logical CSS
properties, and pin the LTR pieces (timestamps, stars, store tags) with
`unicodeBidi: 'isolate'` so an LTR run inside an RTL sentence cannot reorder the
text around it. Neither screen has a button: they list what the caller supplies.

### What is not here yet

- **No collector.** Nothing posts to GlitchTip or Sentry: `mark_sent` records a
  decision, and the HTTP client, the opt-in toggle and the kill switch are the
  collector's, built around this store.
- **No store API client.** No review is fetched from a store; `record` stores what
  the caller already read, and the ingestion job that polls the stores does not
  exist here.
- **No push.** The daily summary is built, not delivered: the Web Push channel and
  its VAPID keys belong to the existing M6 pairing work, and the deep link a
  notification would open (run → run view) has no route yet.
- **No RPC.** `warshad` has no `post_launch.*` methods, so a change request cannot
  open a run from the desktop yet; the store and the status flow are ready for it.
- **Not mounted in a screen.** The allowed scope is the two screens, their tests
  and this chapter, so `App.tsx` and the settings router do not render them (same
  precedent as M14a, M14b, M5a, M5b and M8b).
- **No i18n catalog entries.** The catalog is outside this milestone's files, so
  both screens rely on their local ar/en fallbacks under `post_launch.*`.
