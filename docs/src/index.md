# ورشة · Warsha — Landing

<div dir="rtl" lang="ar">

## ورشة

### مصنع برمجيات بالذكاء الاصطناعي

فكرةٌ في سطر واحد تصبح مستودعاً يعمل: ورشة تدير فريقاً من 12 وكيلاً في مسار مراحل مُبوَّب،
ولا تنتقل خطوة واحدة إلى التالية إلا بموافقتك أنت.

[ابدأ من الدليل السريع](quickstart.md) · [المزوّدون](providers.md) · [البوابات والموافقات](gates.md) · [نموذج الأمان](security.md) · [سجل التغييرات](changelog.md)

### الفيديو التعريفي

```text
┌──────────────────────────────────────────────────────────────────────┐
│  [ موضع الفيديو — 3:00 ]                                             │
│  التثبيت → إضافة مزوّد → مشروع جديد → اعتماد البوابات A/B/C          │
│  → المستودع النهائي: طلبات دمج مدمجة، فحوصات خضراء، إصدار مسوّدة       │
│  يُدرج الإطار هنا بعد موافقة البوابة D على النسخة النهائية.           │
└──────────────────────────────────────────────────────────────────────┘
```

قائمة اللقطات بالتوقيت وشرح كل لقطة في `docs/launch/demo-video.md`، وسياق التصوير وقائمة
«ما لا يُعرض» في `docs/launch/demo-script.md`. الفيديو لم يُصوَّر بعد، فهذا الموضع **علامة صريحة**
لا مشغّل معطّل، ولا شيء في الصفحة يوحي بأن مقطعاً جاهزاً ينتظر نقرة.

<!-- بعد البوابة D: أزل التعليق وضع معرّف الفيديو. الإطار لا يطلب شيئاً من الشبكة قبل ذلك.
<iframe width="960" height="540" src="https://www.youtube.com/embed/VIDEO_ID"
        title="Warsha demo (3:00)" loading="lazy" allowfullscreen></iframe>
-->

### لماذا ورشة

- **مسار واحد واضح** — 14 مرحلة و4 بوابات موافقة بشرية، من الفكرة حتى الإصدار: لا خطوة مخفيّة.
- **12 وكيلاً بأدوار مكتوبة** — لكل وكيل موجّه مُصدَّر ونسخة معروفة، فتعرف من كتب ماذا ولماذا.
- **أحضر مزوّدك** — OpenAI أو Anthropic أو DeepSeek أو Ollama محلياً أو أي واجهة متوافقة مع OpenAI.
- **أسرار في خزانة النظام** — مفاتيح الواجهات تُحفظ في خزانة نظام التشغيل، ولا تظهر في السجلات أو المخارج.
- **ميزانية محسوبة** — سقف لكل مشروع ولكل وكيل، مع إيقاف تلقائي عند التجاوز.
- **محلي أولاً** — قاعدة البيانات والملفات على جهازك، والهاتف يتصل عبر قناة مشفّرة طرفاً لطرف.
- **لا نشر تلقائي** — كل نشر أو تغريدة أو إصدار يمرّ بالبوابة D ويحتاج موافقتك الصريحة.

### الوكلاء الاثنا عشر

| # | الوكيل | الدور | المسؤولية |
|---|--------|-------|-----------|
| 1 | الفرز | `Intake` | يحوّل الفكرة الخام إلى موجز منظّم وأسئلة اكتشاف |
| 2 | الباحث | `Researcher` | يجمع الأدلة والمقارنات والقيود قبل التخطيط |
| 3 | مدير المنتج | `PM` | يكتب وثيقة المتطلبات ويقسّمها إلى مهام قابلة للتنفيذ |
| 4 | المصمّم | `Designer` | يحدّد تدفّق التجربة والواجهات والهوية |
| 5 | المعماري | `Architect` | يختار البنية والمكوّنات وحدود كل جزء |
| 6 | المبرمج | `Coder` | ينفّذ المهام في فرع مستقل داخل بيئة معزولة |
| 7 | المراجع | `Reviewer` | يراجع الفروق والجودة قبل الدمج |
| 8 | ضمان الجودة | `QA` | يشغّل الاختبارات ويتحقّق من قبول المتطلبات |
| 9 | الأمان | `Security` | يفحص الأسرار والتبعيات والصلاحيات |
| 10 | الإصدار | `Release` | يجهّز الحزم والبصمات وملاحظات الإصدار |
| 11 | التسويق | `Marketer` | يكتب نصوص المتاجر ومحتوى الإطلاق |
| 12 | التغذية الراجعة | `Feedback` | يفرز الملاحظات والأخطاء ويقترح الخطة التالية |

### مسار المراحل

```text
Idea → Gate A → Research → PRD Spec → Gate B → Design → Plan Tasks → Code
     → Review / QA / Security → Gate C → Release → Gate D → Launch Drafts → Feedback
```

| البوابة | ماذا تعتمد | من يعتمد |
|---------|------------|----------|
| Gate A | الموجز ونتيجة مقابلة الاكتشاف | المالك |
| Gate B | وثيقة المتطلبات وحدود النطاق | المالك |
| Gate C | نتيجة المراجعة والاختبارات والدمج | المالك |
| Gate D | كل نشر أو إصدار أو منشور علني | المالك |

### أحضر مزوّدك

ورشة لا تبيع نماذج ولا تفرض مزوّداً: تستخدم المفاتيح والحصص التي تملكها أنت.

```bash
# سحابي
warsha providers add openai --name openai --key sk-...
warsha providers add anthropic --name claude --key sk-ant-...

# محلي بلا حساب
warsha providers add ollama --name local-llama --base-url http://localhost:11434
```

### بوابات بشرية

كل عمل حسّاس — إرسال، نشر، دفع، حذف، دفع إلى المستودع — يقف عند بطاقة موافقة.
الوكلاء يقترحون وينفّذون، والمالك يعتمد؛ **لا يستطيع أي وكيل اعتماد بوابة**، ولا يوجد مسار
تلقائي يتجاوزها. التفاصيل في [البوابات والموافقات](gates.md).

### لمن ورشة … ولمن ليست

ورشة أداة لمالك منتج، لا خدمة سحابية. هذا الفصل صريح لأنه أوفر للوقت من التجربة الخاطئة.

**مناسبة لك إذا كنت:**

- مالك منتج واحد تعرفه جيداً، تعمل وحدك أو مع فريق صغير، وتريد أن تصل إلى مستودع يعمل لا إلى عرض تجريبي.
- تريد أن ترى كل خطوة وتعتمدها بنفسك، وتعتبر «وكيلاً ينفّذ بلا مراجعة» خطراً لا ميزة.
- تملك مفاتيحك أو تشغّل نموذجاً محلياً، ويهمّك أن تبقى بياناتك ومخرجاتك على جهازك.
- تكتب بالعربية وتريد واجهة ومخرجات عربية أولاً، مع الإنجليزية عند الحاجة.
- تريد فروعاً وطلبات دمج وفحوصات CI حقيقية، لا ملفات مولَّدة بلا تاريخ.

**غير مناسبة لك إذا كنت:**

- تريد وكيلاً ينشر ويغرّد ويصرف نيابةً عنك بلا مراجعة: كل نشر يمرّ بالبوابة D، وهذا قرار تصميم لا إعداد يمكن إيقافه.
- تريد خدمة مستضافة بمفاتيحنا وحصصنا: ورشة لا تبيع نماذج ولا تحتفظ بمفاتيح على خادمها.
- تريد موقعاً جاهزاً في دقيقة بلا مستودع ولا قراءة كود: المخرجات تحتاج مراجعتك، وهذا هو الغرض.
- تحتاج استخداماً تجارياً: الترخيص **PolyForm Noncommercial 1.0.0**، والاستخدام التجاري يحتاج ترخيصاً منفصلاً.
- تحتاج استقرار إصدار 1.0 أو دعم عملاء واتفاقية مستوى خدمة: أول إصدار لم يُوسم بعد، ولا يوجد فريق دعم.
- تريد أن تُكتب الواجهة المعقّدة كاملةً دون أن تقرأ المخرجات: الوكلاء يقترحون، والقرار والمراجعة لك.

لا شهادات مستخدمين في هذه الصفحة، ولا اقتباسات من «عملاء»: لا أحد استخدم ورشة بعد، واختلاق
شهادة واحدة يبطل بقية الصفحة.

### لا أرقام مزيفة

كل رقم في هذه الصفحة يمكن تتبعه إلى قياس في المستودع، وكل ما لا يمكن تتبعه لا يُكتب:

| الرقم | من أين يُقرأ |
|-------|---------------|
| 12 وكيلاً | اثنا عشر ملف موجّه في `crates/warsha-pipeline/src/prompts/` |
| 14 مرحلة | `Stage::all()` في `crates/warsha-core/src/lib.rs` — 14 عنصراً |
| 4 بوابات | `Stage::is_gate()`: Gate A وGate B وGate C وGate D |
| 3 أنظمة تشغيل | مصفوفة `os:` في `.github/workflows/ci.yml` و`release.yml` |
| 6 فحوصات ما قبل الإصدار | قائمة `ReleasePreflight` الثابتة |

ما لا تجده في هذه الصفحة عن قصد: عدد مستخدمين، عدد تنزيلات، عدد نجوم، تقييم متجر، شهادات، أو
جدول أداء بلا أمر يعيد إنتاجه. أول رقم من هذا النوع يُنشر يحمل معه رابط القياس؛ وإن لم يوجد
قياس، لا يُنشر الرقم. الفحص نفسه بند مراجعة قبل كل نشر، وأمرُه وجدولُه في
`docs/launch/demo-video.md` (قسم «Numeric claims check»).

### لقطات الشاشة

```text
┌──────────────────────────────────────────────────────────────┐
│  [ لقطة الشاشة: الوضع البسيط — الشريط الجانبي للوكلاء ]      │
│  تعرض قائمة الوكلاء الاثني عشر وحالة كل وكيل والبطاقات         │
│  المعلّقة للموافقة. تُلتقط بعد تصوير الفيديو التعريفي.          │
└──────────────────────────────────────────────────────────────┘
```

تُضاف اللقطات النهائية إلى `docs/src/screenshots/` قبل الإطلاق، وتُدرج هنا بوصف نصي بديل
لكل صورة. حتى ذلك الحين يبقى هذا الموضع علامة مؤقتة صريحة، لا صورة ناقصة.

### ابدأ الآن

```bash
warsha init
warsha new "متجر إلكتروني صغير بواجهة عربية وإنجليزية"
warsha gates
```

الدليل الكامل خطوة بخطوة في [الدليل السريع](quickstart.md).

### الترخيص

ورشة مرخّصة بموجب **PolyForm Noncommercial 1.0.0**: الاستخدام الشخصي والتعليمي والبحثي
وغير الربحي مسموح، والاستخدام التجاري يحتاج ترخيصاً منفصلاً. اقرأ
[ملاحظة الترخيص](tos.md) وملف `LICENSE` في جذر المستودع.

</div>

<div dir="ltr" lang="en">

## English fallback

**Warsha (ورشة)** — an Arabic-first AI software factory. Tagline: «ورشة: مصنع برمجيات بالذكاء الاصطناعي»
(Warsha: a software factory powered by artificial intelligence).

One line of idea becomes a working repository: Warsha runs a team of twelve agents through a
gated pipeline, and no stage advances without your approval.

- **One visible pipeline** — 14 stages, 4 human gates, from idea to release.
- **Twelve written roles** — Intake, Researcher, PM, Designer, Architect, Coder, Reviewer, QA,
  Security, Release, Marketer, Feedback, each driven by a versioned prompt file.
- **Bring your own provider** — OpenAI, Anthropic, DeepSeek, a local Ollama, or any
  OpenAI-compatible endpoint.
- **Secrets in the OS keychain** — never in config files, logs, or command output.
- **Budgets that hold** — per project and per role, with an automatic pause on overrun.
- **Local-first** — state and artifacts stay on your machine; the phone pairs over an
  end-to-end encrypted channel.
- **No auto-publishing** — every post, release, or push waits at Gate D for the owner.

Pipeline: `Idea → Gate A → Research → PRD Spec → Gate B → Design → Plan Tasks → Code →
Review / QA / Security → Gate C → Release → Gate D → Launch Drafts → Feedback`.

Agents propose and execute; the owner approves. **No agent can approve a gate**, and there is no
automatic path around one — see [Gates and approvals](gates.md).

### Demo video

```text
┌──────────────────────────────────────────────────────────────────────┐
│  [ VIDEO — 3:00 ]                                                     │
│  install → add a provider → new project → approve Gates A/B/C        │
│  → final repository: merged PRs, green checks, a draft release       │
│  The embed goes here after Gate D approves the final cut.             │
└──────────────────────────────────────────────────────────────────────┘
```

The frame-by-frame shot list is in `docs/launch/demo-video.md`; the recording setup, the do-not-show
list and the post-production rules are in `docs/launch/demo-script.md`. The video has not been
recorded yet, so this is an explicit placeholder, not a dead player — nothing on this page pretends
a clip is one click away.

### Who it is for / who it is not for

Warsha is a tool for one product owner, not a hosted service. This split is blunt on purpose: it
saves more time than a wrong trial.

**It fits you if you:**

- own one product you understand, work alone or with a small team, and want a working repository
  rather than a demo;
- want to see and approve every step, and count "an agent that just executes" as a risk, not a feature;
- bring your own keys or run a local model, and care that your state and artifacts stay on your machine;
- write in Arabic and want the interface and the artifacts Arabic-first, English when needed;
- want real branches, pull requests and CI checks instead of generated files with no history.

**It does not fit you if you:**

- want an agent that publishes, posts and spends on your behalf with no review — every publication
  waits at Gate D, and that is a design decision, not a setting you can turn off;
- want a hosted service billed on our keys and our quota; Warsha sells no models and keeps no key on
  a server;
- want a finished site in a minute with no repository and no code reading; the output expects your
  review, which is the point;
- need commercial use: the licence is **PolyForm Noncommercial 1.0.0**, and commercial use needs a
  separate licence;
- need 1.0 stability, customer support, or an SLA: no release tag exists yet and there is no support team;
- want a complex interface written end to end without reading the output; the agents propose, and the
  decision and the review are yours.

There are no testimonials and no customer quotes on this page, because nobody has used Warsha yet —
one invented quote would invalidate the rest of the page.

### No fake metrics

Every number on this page traces to a measurement in the repository, and anything that does not trace
is not written:

| Number | Where it is read from |
|--------|-----------------------|
| 12 agents | the twelve prompt files in `crates/warsha-pipeline/src/prompts/` |
| 14 stages | `Stage::all()` in `crates/warsha-core/src/lib.rs` — fourteen entries |
| 4 gates | `Stage::is_gate()`: Gate A, Gate B, Gate C, Gate D |
| 3 operating systems | the `os:` matrix in `.github/workflows/ci.yml` and `release.yml` |
| 6 preflight checks | `ReleasePreflight`'s fixed check list |

Deliberately absent: user counts, download counts, star counts, store ratings, testimonials, and any
performance table without a command that reproduces it. The first metric of that kind to appear here
carries its measurement link; with no measurement, it is not published. The check itself is a review
item before every publication — command and claims table in `docs/launch/demo-video.md`, section
"Numeric claims check".

Start with the [Quickstart](quickstart.md). Licensed under **PolyForm Noncommercial 1.0.0**
(personal, educational, research, and non-profit use); commercial use needs a separate license.
See [Terms of Service note](tos.md). What changed, milestone by milestone, is in the
[Changelog](changelog.md).

</div>
