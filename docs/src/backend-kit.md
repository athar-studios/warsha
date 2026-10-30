# Backend Kit

<div dir="rtl" lang="ar">

## حزمة الواجهة الخلفية

المشروع الذي يولّده ورشة يحتاج واجهة خلفية جاهزة بدل أن يبنيها من الصفر.
هذا الفصل يوثّق الطبقة التي تسجّل اختيار المالك لما بناه الوكيل عليها: أي
واجهة خلفية، وأي خدمة، وأي جدول وسياسة وصول، ثم التصدير القياسي الذي يبقي
البيانات في يد صاحبها.

- **واجهتان مفتوحتان المصدر**: `PocketBase` (رخصة MIT، ملف تنفيذي واحد،
  الخيار المفضّل في الخطة) و`Supabase` (Postgres وسياسات الصفوف وخدمات
  منفصلة).
- **خمس خدمات** يختارها المالك: `auth` و`postgres_rls` و`storage` و`push`
  و`functions`.
- **ما ينشئه الوكيل** يُسجَّل هنا: الجداول وأعمدتها، وسياسات أمان الصفوف،
  والدلاء، والدوال.
- **التصدير القياسي**: ملف SQL واحد يحوي كل `CREATE TABLE` ثم عبارات أمان
  الصفوف، مع مسار الأرشيف الذي يجب أن يُحزم فيه التخزين.
- **المدفوعات لا تُفتح تلقائيًا**: لا تُفعّل إلا بموافقة مالك صريحة تحمل اسمًا
  ووقتًا، والبوابة المخصّصة لذلك تبقى مغلقة بخلاف ذلك.

القاعدة التي لا تتغيّر: كل ما يدخل هذه الحزمة يأتي من وكيل، فالأسماء تُفحص
قبل أن تصبح SQL، والتعبير في سياسة الصفوف يجب أن يكون تعبيرًا واحدًا لا
يحوي فاصلة منقوطة. ولا يفتح هذا الفصل أي اتصال: الحزمة تسجّل وتصدّر، ولا
تتصل بأي خدمة.

</div>

## English

The backend kit is the M19 _definition layer_: the record of which open-source
backend the project uses, which services the owner turned on, and what the agent
created on top of it — plus the standard export that keeps the data with its
owner. LingCode-inspired ideas only: no code, text or asset was copied from it. No
dependency was added, no `Cargo.toml` edited, no `.github/workflows/**` change
and no i18n catalog entry.

| Deliverable                                                | Path                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------ |
| Kinds, config, tables, RLS policies, export, payments gate | `crates/warsha-pipeline/src/backend_kit.rs`                        |
| Desktop panel                                              | `apps/desktop/src/components/BackendKitPanel.tsx`                  |
| Tests                                                      | `backend_kit::tests` in Rust (16), `BackendKitPanel.test.tsx` (10) |

### The types

```rust,ignore
pub enum BackendKind { PocketBase, Supabase }

pub struct BackendConfig {
    pub kind: BackendKind,
    pub url: String,
    pub project_name: String,
    pub enabled_features: Vec<BackendFeature>,
}

pub enum BackendFeature { Auth, PostgresRls, Storage, Push, Functions }

pub struct BackendKit {
    pub config: BackendConfig,
    pub tables: Vec<TableDef>,
    pub rls_policies: Vec<RlsPolicy>,
    pub storage_buckets: Vec<String>,
    pub functions: Vec<String>,
}

pub struct ColumnDef { pub name: String, pub col_type: String, pub nullable: bool }
pub struct TableDef { pub name: String, pub columns: Vec<ColumnDef> }

pub struct RlsPolicy {
    pub table: String,
    pub policy_name: String,
    pub expression: String,
    pub operation: RlsOperation,
}

pub enum RlsOperation { Select, Insert, Update, Delete, All }
```

`BackendKind` and every other enum serialize as `snake_case`
(`pocket_base`, `supabase`, `postgres_rls`, `all`), so the daemon, the desktop
panel and a stored `backend.json` all spell them the same way.
`BackendConfig::with_feature` keeps `enabled_features` in
`BackendFeature::all` order, which is also the order the panel lists the
toggles in — the UI and the dump header cannot disagree.

### What `add_*` refuses

The agent proposes, and the kit checks. Nothing is stored when a check fails.

| Call                                  | Refused when                                                  | Error                              |
| ------------------------------------- | ------------------------------------------------------------- | ---------------------------------- |
| `add_table`                           | the name is not `[A-Za-z_][A-Za-z0-9_]*`                      | `InvalidIdentifier`                |
| `add_table`                           | the table has no columns                                      | `EmptyTable`                       |
| `add_table`                           | a column name repeats                                         | `DuplicateColumn`                  |
| `add_table`                           | the type is not plain SQL (`TEXT`, `numeric(10,2)`, `text[]`) | `InvalidColumnType`                |
| `add_table`                           | the table already exists                                      | `DuplicateTable`                   |
| `add_rls_policy`                      | the table is not defined yet                                  | `UnknownTable`                     |
| `add_rls_policy`                      | the expression is blank or contains `;`                       | `InvalidPolicyExpression`          |
| `add_rls_policy`                      | the policy name repeats on that table                         | `DuplicatePolicy`                  |
| `add_storage_bucket` / `add_function` | the name is unsafe or already taken                           | `InvalidIdentifier` / `Duplicate…` |

Two of those rules matter beyond tidiness. **The type screen** is what stops
`TEXT; DROP TABLE users` from reaching the dump: a type may only contain ASCII
letters, digits, spaces and `_ ( ) , [ ] .`. **The table must exist first** for a
policy, so creation order and dump order are the same order, and a policy can
never point at a table the export does not create.

### The export

`BackendKit::export()` returns an `ExportBundle`:

```rust,ignore
pub struct ExportBundle {
    pub sql_dump: String,
    pub storage_archive_path: Option<String>,
}
```

The dump is ordered the way Postgres needs it: a header comment, then every
`CREATE TABLE IF NOT EXISTS`, then `ALTER TABLE … ENABLE ROW LEVEL SECURITY` for
each table that has at least one policy, then the `CREATE POLICY` statements.

```sql
-- Warsha backend kit export
-- backend: PocketBase
-- project: My App
-- url: http://127.0.0.1:8090
-- features: auth, storage

CREATE TABLE IF NOT EXISTS "posts" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "published" BOOLEAN NOT NULL
);

ALTER TABLE "posts" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "posts_select_published" ON "posts" FOR SELECT USING (published = true);
CREATE POLICY "posts_insert_own" ON "posts" FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "posts_all_own" ON "posts" FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
```

`INSERT` gets a `WITH CHECK` clause, `SELECT`/`UPDATE`/`DELETE` get `USING`, and
`ALL` gets both — that is what Postgres accepts, not a stylistic choice.

The header carries the project name and the URL, so both are run through a
comment screen first: a newline would end the `--` comment and turn the rest of a
project name into SQL. Identifiers are screened by `is_safe_identifier` and then
quoted anyway, doubling an embedded `"`.

`storage_archive_path` is `Some("<slug>-storage.tar.gz")` when the project has at
least one bucket and `None` otherwise, and the slug is the project name lower-
cased with every non-alphanumeric run collapsed to `-`. **Nothing is written to
disk**: the bundle names the archive, the caller packs it, and the function
sources stay the caller's to deploy. Buckets and functions cannot be created by
SQL on either backend, so they are listed in the header comment instead of being
faked as DDL.

### The payments gate

```rust,ignore
pub struct PaymentsGate { pub enabled: bool, pub approved_by: Option<String>, pub approved_at: Option<u64> }
```

| Call                          | Result                                        |
| ----------------------------- | --------------------------------------------- |
| `PaymentsGate::new()`         | shut                                          |
| `enable("owner", 1700000000)` | sets the flag, the approver and the timestamp |
| `enable("   ", 1)`            | `ApprovalRequired`, nothing changes           |
| `enable("owner", 0)`          | `InvalidApproval`, nothing changes            |
| `enable(..)` on an open gate  | `PaymentsAlreadyEnabled`                      |
| `disable()`                   | drops the flag and the approval record        |

`is_enabled()` is the field **and** a named approver **and** a timestamp, so
setting the public `enabled` field by hand does not read as an approved gate —
one test covers exactly that. There is no auto-enable path anywhere in the module.

### The desktop panel

`BackendKitPanel.tsx` is a controlled component: `kind`, `features`, `tables` and
`payments` come from props, and every edit calls back out (`onKindChange`,
`onToggleFeature`, `onExport`).

- The kind selector is a `role="radiogroup"` of two `role="radio"` buttons with
  `aria-checked`, so the current backend is announced, not just coloured.
- Five checkboxes, one per service, in `BackendFeature::all` order.
- One row per table: the name and the columns in mono, `dir="ltr"`, with
  `nullable` spelled out.
- **Export** is disabled with no tables, and its `title` says why: a dump with no
  schema is the header comment alone.
- The payments chip shows the approver and the timestamp, or
  "off — owner approval required". `paymentsGateEnabled()` mirrors the Rust rule,
  `paymentsGateText()` builds the line, and `canExport()` decides the button — one
  table shared by the panel, its `title` and the tests.

RTL: the root takes `dir` from `useDirection()`, the padding is
`paddingBlock`/`paddingInline`, the table list uses `paddingInlineStart`, and the
spacing is flex `gap` rather than a side margin. Identifiers and URLs stay
`dir="ltr"` inside the mirrored panel, so a table name does not render reversed.

### What is not here yet

- **No MCP transport and no backend client.** PLAN.md M19 drives the backend
  through the backend's own MCP server; this module is the state those calls are
  recorded against. Nothing in it opens a socket.
- **The export is not applied and not written.** `export()` builds the bundle in
  memory; writing `schema.sql`, packing the archive, and replaying the dump into a
  fresh instance are the caller's job, so the AC's "export round-trips into a
  fresh instance" is not claimed here.
- **The URL is not validated.** `BackendConfig.url` is stored as the owner typed
  it, and reachability belongs to the MCP client that does not exist yet.
- **The panel is not mounted.** The allowed scope is the component plus its tests,
  so no screen shows it yet; `onExport` has no RPC behind it.
