# Scale Standards

<div dir="rtl" lang="ar">

## معايير التوسّع

التطبيق الذي يولّده ورشة ويعمل على حاسوب المالك ثم يسقط عند خمسين مستخدمًا ليس
تطبيقًا منتهيًا. والسبب في الغالب ليس معقّدًا: مفتاح أجنبي بلا فهرس، ونقطة قائمة
تُرجع كل الصفوف، واستعلام داخل حلقة، ومجمّع اتصالات يُفتح لكل طلب، وبلا سقف
لحجم الطلب، وبلا مهلة، وسجلات نصوص مركّبة، وبلا مسار صحّة. هذا الفصل هو تلك
القائمة، مكتوبة كبيانات في الكود.

- **ثمانية معايير** في أربع فئات: قاعدة البيانات، واجهة البرمجة، الرصد، الأمان.
- **كل معيار** له معرّف ثابت (`database.foreign_key_indexes`)، وجملة واحدة تصفه،
  وخطوة فحص يستطيع المراجع تنفيذها.
- **مصدر واحد**: `ScaleStandards::checklist()` هو النص نفسه الذي يُحقن في دور
  المبرمج (ابنِه هكذا) والمراجع (ارفضه إن لم يكن) وقالب المواصفات (اكتبه في
  المتطلبات)، فلا تتباعد النسخ الثلاث.
- **البوابة تقتبس المعرّف**: تقرير المراجعة يذكر `[api.pagination]` لا "ترقيم
  الصفحات ناقص"، فيمكن تتبّع الرفض إلى قاعدة واحدة.

القاعدة التي لا تتغيّر: هذه الطبقة تصف الفحوص ولا تراجع مستودعًا. لا تقرأ ملفًا
ولا تشغّل استعلامًا ولا تعدّل برومبت. الروابط التي تُدخل القائمة في البرومبتات
لم تُبنَ بعد، وهذا الفصل يقول ذلك بدل أن يدّعيه.

</div>

## English

The scale standards are the M20 baseline every generated app is reviewed against.
A generated app that works on the owner's laptop and falls over at fifty users is
not finished, and the failure is almost never exotic — it is one of eight
ordinary omissions. This chapter is the long form of
`crates/warsha-pipeline/src/scale_standards.rs`: the standard, why it matters,
and how each one is meant to reach the role prompts.

| Deliverable              | Path                                                  |
| ------------------------ | ----------------------------------------------------- |
| The table and its reader | `crates/warsha-pipeline/src/scale_standards.rs`       |
| This chapter             | `docs/src/scale-standards.md`                         |
| Tests                    | `scale_standards::tests` in Rust (4)                  |

### The types

```rust,ignore
pub enum ScaleCategory {
    Database,
    Api,
    Observability,
    Security,
}

pub struct ScaleStandard {
    pub id: String,
    pub category: ScaleCategory,
    pub description: String,
    pub check: String,
}

pub static SCALE_STANDARDS: LazyLock<[ScaleStandard; 8]>;

pub struct ScaleStandards;

impl ScaleStandards {
    pub fn all() -> &'static [ScaleStandard];
    pub fn by_category(category: ScaleCategory) -> Vec<&'static ScaleStandard>;
    pub fn get(id: &str) -> Option<&'static ScaleStandard>;
    pub fn checklist() -> Vec<String>;
}
```

The table is a `static LazyLock<[ScaleStandard; 8]>` rather than a `const`,
because a `const` cannot own a `String`. `Deref` makes `SCALE_STANDARDS.iter()`
and `SCALE_STANDARDS[0]` work, and `ScaleStandards::all()` hands the same data
out as `&'static [ScaleStandard]`, so there is one table and no copy to drift.
No dependency was added for this module.

### The eight standards

| Id                                  | Category      | Rule                                                                       | Why it matters                                                                                                                                     | How a reviewer checks it                                                                              |
| ----------------------------------- | ------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `database.foreign_key_indexes`      | Database      | Every foreign-key column has its own index.                                | Postgres does not index the referencing side of a foreign key. Joins and `ON DELETE` cascades scan the whole child table, and the cost grows with it. | For each `REFERENCES` column, find the index on the referencing side — not the referenced side.        |
| `database.no_n_plus_one`            | Database      | A list screen issues a bounded number of queries, not one per row.          | A loop that fetches a row's owner turns one query into N+1. Ten rows look fine; a thousand rows take the database down.                             | Count the queries the list endpoint runs for ten rows and for a hundred. The count must not grow.      |
| `database.connection_pooling`       | Database      | One bounded pool with an acquire timeout.                                   | A connection per request exhausts Postgres' `max_connections` under load, and an unbounded pool turns a slow query into an out-of-memory kill.      | Find the pool constructor: a maximum size and an acquire timeout must both be visible and finite.      |
| `api.pagination`                   | Api           | Every list endpoint takes a page size and a cursor or offset, with a hard maximum. | An unpaginated list is a query whose cost is chosen by the client. One `GET /posts` with no ceiling is a denial of service with a valid token.      | Call each list endpoint with no page size and with an absurd one. Both responses must be bounded, with a next page. |
| `api.timeout_budget`                | Api           | Every request has a deadline, shorter than its caller's.                    | Without a server deadline the server holds the connection while the client has already given up; retries then stack on the same stuck work.        | Compare the per-request timeout with the client's own: the server must give up first.                  |
| `observability.structured_logs`     | Observability | Logs are structured records with a request id, never concatenated sentences. | A log line built with `format!` cannot be filtered or counted, and without a request id a failure cannot be followed across services.               | Grep the request path for formatted log lines; each must carry fields (request id, route, status, duration). |
| `observability.health_endpoint`     | Observability | A health endpoint answers without touching the data path.                   | A health check that queries the database hangs exactly when the database hangs, so the orchestrator cannot tell "unhealthy" from "unresponsive".   | Stop the database and call the health endpoint: it must answer, and report the database as unhealthy.  |
| `security.request_size_limit`       | Security      | Request bodies have a size ceiling, refused before parsing.                 | An unbounded body is parsed, then buffered, then stored — one request can exhaust memory before any validation runs.                                 | POST a body above the ceiling and confirm a 413-class refusal that never reaches the parser.           |

`security.request_size_limit` sits in Security rather than Api on purpose: it is
an abuse ceiling, and the thing it protects is memory and the parser, not the
endpoint's contract.

### How the checklist reaches a role prompt

The same lines go to three places, and all three read
`ScaleStandards::checklist()` instead of a copied list:

1. **Coder** — "build it this way": the checklist is appended to the coding task
   prompt, so the standard is a requirement the agent implements rather than a
   review it fails later.
2. **Reviewer** — "reject it if it does not": the checklist is the review rubric,
   and a finding quotes the id (`[api.pagination] GET /posts returns every row`).
3. **Spec template** — the PRD names the eight checks, so Gate B is where the
   owner sees them, not Gate C.

Each rendered line is `[<id>] <rule> — <check>`, one line per standard in table
order, which is what makes a gate report quotable.

### What is not here yet

- **The prompt files are not edited.** `crates/warsha-pipeline/src/prompts/*.md`
  is a versioned asset outside this batch's change set. `architect.md` already
  says "Database: normalized with indexes" and "API: versioned, paginated,
  rate-limited"; the other seven standards are not in any prompt yet, so
  "enforced in the role prompts" is the seam below, not a shipped behaviour.
- **No eval case.** The PLAN item asks for one; `evals.rs` is outside this batch,
  so nothing yet asserts that a Coder reply citing the standards passes.
- **Nothing reviews a repository.** `check` is a sentence a human or a later
  checker performs. There is no query counter, no migration parser and no
  endpoint prober in this module.
- **No UI.** The Advanced-mode review pane does not render the checklist yet.

The store, the cache and these standards are three separate seams that share one
property: each is a pure data layer with tests, and each names the caller that
would make it live instead of implying it already exists.
