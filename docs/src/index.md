# ورشة · Warsha — Landing

<div dir="rtl" lang="ar">

## ورشة

### مصنع برمجيات بالذكاء الاصطناعي

فكرةٌ في سطر واحد تصبح مستودعاً يعمل: ورشة تدير فريقاً من 12 وكيلاً في مسار مراحل مُبوَّب،
ولا تنتقل خطوة واحدة إلى التالية إلا بموافقتك أنت.

[ابدأ من الدليل السريع](quickstart.md) · [المزوّدون](providers.md) · [البوابات والموافقات](gates.md) · [نموذج الأمان](security.md)

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

Start with the [Quickstart](quickstart.md). Licensed under **PolyForm Noncommercial 1.0.0**
(personal, educational, research, and non-profit use); commercial use needs a separate license.
See [Terms of Service note](tos.md).

</div>
