# Status Strip and Delivery

<div dir="rtl" lang="ar">

## شريط الحالة والتسليم

ثلاثة عناصر واجهة تجعل طريق الشحن ظاهرًا بلا فتح سجلات البناء:

- **شريط الحالة** — مكانه أسفل المحادثة: «فحوصات الكود ← البناء ← الاختبارات ←
  جاهز للمتجر». كل مرحلة ملوّنة: أخضر عند النجاح، أحمر عند الفشل، رمادي في
  الانتظار، ودوّامة أثناء التشغيل. الشريط يقرأ حالة الفحوصات الموجودة في
  CI/GitHub ولا يشغّل أي فحص بنفسه. (هذه الدفعة ترسمه في الشريط العلوي للتطبيق،
  حتى يصل مكانه أسفل المحادثة.)
- **فحص ما قبل الإصدار** — قائمة من ست خطوات: التنسيق والتحليل (lint)، فحص
  الأنواع، الاختبارات، البناء، قائمة المكوّنات (SBOM)، والبصمات (SHA256). شارة
  واحدة تقول: «جاهز للإصدار» أو «محجوب» أو «بانتظار التشغيل».
- **زر النشر إلى الويب** — ينشر نسخة الويب المبنية إلى الهدف المضبوط. يظهر
  مؤشرًا أثناء النشر، وعلامة نجاح أو فشل بعده، ولا يُقرأ منه أي سر: المزوّد
  وبيانات الاعتماد تبقى في مخزن مفاتيح النظام.

### قاعدة البوابة

زر النشر يبقى معطّلًا حتى تصبح المراحل الأربع خضراء كلها. مرحلة واحدة في
الانتظار أو فاشلة تكفي لإبقاء الزر مغلقًا، وتحته جملة تشرح السبب.

### اتجاه الواجهة

الشريط يستخدم `dir` وخصائص CSS المنطقية (`paddingInline`)، والسهم ينعكس في
العربية ليقرأ «←» بدل «→». لا `left` ولا `right` في أي نمط.

</div>

## English

Three small components make the ship path visible without opening a build log. They are
desktop-only UI: `apps/desktop/src/components/StatusStrip.tsx`, `ReleasePreflight.tsx` and
`WebDeployButton.tsx`. LingCode-inspired ideas only: no code, text or asset was copied from it.

### Status strip

```ts
type StageStatus = 'pending' | 'running' | 'pass' | 'fail';

interface DeliveryStage {
  name: string; // 'code_checks' | 'builds' | 'tests' | 'store_ready' are localized
  status: StageStatus;
}

function StatusStrip(props: { stages: DeliveryStage[] }): JSX.Element;
```

The four stages render in ship order with an arrow between each pair: **Code checks → Builds
→ Tests → Store-ready**. Colour coding is a single table, so every stage looks alike:

| Status    | Glyph | Colour                     | Meaning             |
| --------- | ----- | -------------------------- | ------------------- |
| `pending` | `○`   | gray `#6b7280` on `#f3f4f6` | not started yet     |
| `running` | spinner | blue `#1e40af` on `#dbeafe` | running now         |
| `pass`    | `✓`   | green `#166534` on `#dcfce7` | passed              |
| `fail`    | `✗`   | red `#991b1b` on `#fee2e2`   | failed, needs a fix |

The spinner is an SVG circle with an SMIL `animateTransform`. Keeping the rotation out of a
stylesheet matters twice: no `@keyframes` block has to be injected into the page, and jsdom —
the DOM the component tests run in — never has to parse one.

The strip is a pure function of `stages`. It **does not run a check**: the statuses are the
existing CI/GitHub check status, so the same component serves the run view and the release
view. Two helpers keep callers honest:

```ts
initialDeliveryStages(): DeliveryStage[];   // the four stages, all pending
allStagesGreen(stages: DeliveryStage[]): boolean; // true only when non-empty and all pass
```

A stage name the component does not know is rendered as given, so a project-specific stage
does not need a catalog entry. `normalizeStageName` turns `Store Ready` and `store-ready`
into `store_ready`, which is what selects the localized label.

### Release preflight

```ts
interface PreflightCheck {
  name: string; // lint, typecheck, tests, build, sbom, checksums are localized
  status: 'pending' | 'pass' | 'fail';
}

function ReleasePreflight(props: {
  checks: PreflightCheck[];
  onRun: () => void;
  disabled: boolean;
}): JSX.Element;
```

Six rows in run order, each with its glyph, and one badge for the whole list:

| Overall   | When                                            | Badge text        |
| --------- | ----------------------------------------------- | ----------------- |
| `pass`    | the list is non-empty and every check passed     | Ready to release  |
| `fail`    | any check failed, whatever the others say        | Blocked           |
| `pending` | anything else, including an empty list           | Waiting           |

One failure blocks the release even while the rest are still pending: a red badge should not
wait for the last check to finish. `overallPreflightStatus` and `preflightReady` expose that
rule, and the row count line (`2 of 6 passed`) is what the owner reads first. `onRun` is the
seam for re-running the preflight with the existing open-source tooling (lint, typecheck,
tests, build, SBOM, checksums); `disabled` is the caller's switch — the button never decides
for itself.

### Web deploy button

```ts
function WebDeployButton(props: {
  disabled: boolean;
  onDeploy: () => void;
  status: 'idle' | 'deploying' | 'done' | 'error';
}): JSX.Element;
```

| Status      | Glyph   | Label         |
| ----------- | ------- | ------------- |
| `idle`      | `↑`     | Deploy to web |
| `deploying` | spinner | Deploying…    |
| `done`      | `✓`     | Deployed      |
| `error`     | `✗`     | Deploy failed |

A live (`role="status"`, `aria-live="polite"`) line under the button says what happened, so
the state is not carried by colour alone. Two rules are deliberately enforced in the
component rather than left to the caller: a click while `deploying` is swallowed (a second
deploy must not be queued by a double click), and `disabled` keeps the button off with a
tooltip that names the reason — the release preflight is what sets it.

### What is not here yet

- **No live feed.** `App.tsx` mounts the strip in the top bar with the four stages seeded
  pending. The CI/GitHub check status arrives through a delivery RPC that does not exist in
  `warshad` yet; the strip's `stages` prop is the seam it will drive.
- **No check runner.** The preflight renders whichever checks the caller ran. Nothing in
  this milestone spawns lint, tests, SBOM or a checksum pass, and no draft release is created
  from the UI yet.
- **No deploy backend.** `onDeploy` has no RPC behind it, so the button reports intent only.
  The deploy target and the provider credentials stay in the OS keychain, and publishing
  publicly remains a Gate D decision, never an automatic side effect of a deploy.
- **Nothing is mounted for the preflight or the deploy button.** They are standalone, like
  the work-protection and router components, because the screens they belong to were outside
  this milestone's file scope.
