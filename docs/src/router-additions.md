# Router Additions

<div dir="rtl" lang="ar">

## إضافات الموجّه

الموجّه في ورشة يقرّر أي نموذج يخدم كل خطوة. هذه الإضافات تجعل القرار مرئيًا
وقابلًا للتغيير من الواجهة، وتضيف مسارًا محليًا آمنًا عند انقطاع الشبكة.

- **شريحة محلي/سحابي** — كل هدف في الموجّه وفي عرض التكاليف يحمل شريحة تقول
  «محلي» أو «سحابي»، حتى يعرف المالك أين يعمل النموذج فعلًا.
- **الوضع الاقتصادي (Eco)** — عند تشغيله يذهب العمل إلى نموذج محلي عندما يكون
  الجهاز على البطارية وتحت حدّ معيّن، أو عندما تنقطع الشبكة. المفتاح ظاهر في
  شريط الحالة، ويعمل دون إعادة تشغيل.
- **افتراضيات لكل مهمة** — يمكن تثبيت نموذج لمهمة واحدة (مثل `unit-tests`) دون
  تغيير الإعداد الافتراضي للدور كله.
- **رجوع محلي عند فشل الشبكة** — إذا فشلت كل الأهداف السحابية بخطأ شبكة، يجرّب
  الموجّه نموذجًا محليًا بدل أن يتوقف التشغيل.
- **إعداد بضغطة واحدة** — OpenRouter وDeepSeek وKimi وGLM وQwen، وأي نقطة نهاية
  متوافقة مع OpenAI. زر «اختبر الاتصال» يفحص ثلاثًا: العنوان، والمفتاح، والنموذج،
  ويعطي سببًا لكل فاشل — بلا أي اتصال بالشبكة.

### الحالات الثلاث في «اختبر الاتصال»

| الفحص   | ينجح عندما                              | مثال على السبب                          |
| ------- | --------------------------------------- | --------------------------------------- |
| العنوان | يبدأ بـ `http://` أو `https://` وله مضيف | «يجب أن يبدأ عنوان URL بـ http://…»     |
| المفتاح | غير فارغ وبلا مسافات                    | «أدخل مفتاح API.»                       |
| النموذج | معرّف غير فارغ                          | «أدخل معرّف النموذج.»                   |

</div>

## English

The router decides which model serves each step. These additions make that decision visible
and adjustable, and add a safe local path when the network is gone. The Rust side lives in
`crates/warsha-pipeline/src/router_quality.rs` (routing decisions) and
`crates/warsha-providers/src/provider_setup.rs` (one-click setup and the connection test);
the desktop components are `LocalCloudBadge.tsx`, `EcoModeToggle.tsx` and
`ProviderSetupWizard.tsx`.

LingCode-inspired ideas only: no code, text or asset was copied from it.

### Local vs cloud badge

Every router target carries a kind, so the router and cost views can label it:

```rust,ignore
pub enum TargetKind { Local, Cloud } // serde snake_case: "local" / "cloud"

pub struct RouterTarget {
    pub name: String,   // "ollama", "openrouter", …
    pub kind: TargetKind,
    pub model: String,  // "qwen2.5:3b", "openai/gpt-4o-mini", …
}
```

`LocalCloudBadge` renders that kind as a pill in both languages and puts the target name and
model in the tooltip. The pre-existing `warsha_core::RoutingTarget` (provider id, model id,
weight) is unchanged: it drives the fallback loop, and it has no notion of local or cloud.

### Eco mode

```rust,ignore
pub struct EcoMode {
    pub enabled: bool,               // default false
    pub battery_threshold_pct: u8,   // default 20
    pub fallback_to_local: bool,     // default true
}

pub fn decide(&self, is_battery: bool, battery_pct: u8, network_ok: bool) -> EcoModeDecision;
```

The decision order is fixed:

1. Eco mode off → cloud, reason "eco mode is off".
2. No network → local when `fallback_to_local`, otherwise cloud with a reason that says the
   fallback is disabled. Offline wins over the battery check: no cloud target can answer.
3. On battery at or below `battery_threshold_pct` → local when `fallback_to_local`.
4. Otherwise cloud ("on mains power" or "above the threshold").

`EcoModeDecision` is `{ use_local, reason }`; the reason is plain language for the event log
and the toggle's tooltip. `EcoModeToggle` is bound to `onChange`, is a `role="switch"` with
`aria-checked`, and shows the battery and network values the decision was made from. Toggling
is pure state: no restart, no re-login.

### Per-task defaults

```rust,ignore
pub struct PerTaskDefault { pub task: String, pub model: String }

pub struct PerTaskDefaults { /* task -> model */ }
```

`set` (and `set_default`) return the model a pin replaced, `get` returns the pin, `remove`
drops it, `defaults()` lists every pin sorted by task name, and `model_for(task, role_default)`
returns the pin when there is one and the role default otherwise. A pin changes one task and
leaves the role preset untouched.

### Local fallback on network failure

```rust,ignore
pub struct LocalFallbackPolicy { pub enabled: bool, pub max_retries: u8 }

pub fn should_fallback(&self, error: &str) -> bool;
```

The policy answers "may a local target absorb this error?" It is true when the policy is
enabled and the error text mentions `network`, `timeout` or `connection` (case-insensitive),
and false for everything else — an auth or model-not-found error is not retried locally. The
router keeps trying the next cloud target first; a local target is the last resort, and
`max_retries` bounds the local attempts.

### One-click provider setup

```rust,ignore
pub enum OneClickProvider { OpenRouter, DeepSeek, Kimi, Glm, Qwen, Custom }

pub fn default_base_url(self) -> Option<&'static str>; // None for Custom
```

| Provider     | Default base URL                                     |
| ------------ | ---------------------------------------------------- |
| `OpenRouter` | `https://openrouter.ai/api/v1`                       |
| `DeepSeek`   | `https://api.deepseek.com/v1`                        |
| `Kimi`       | `https://api.moonshot.cn/v1`                         |
| `Glm`        | `https://open.bigmodel.cn/api/paas/v4`               |
| `Qwen`       | `https://dashscope.aliyuncs.com/compatible-mode/v1`  |
| `Custom`     | — the owner supplies the URL                          |

All five hosted endpoints are OpenAI-compatible, so they reuse the existing adapter.

### Test connection: three distinct error classes

```rust,ignore
pub struct ConnectionTestResult {
    pub url_ok: bool,
    pub key_ok: bool,
    pub model_ok: bool,
    pub url_reason: Option<String>,
    pub key_reason: Option<String>,
    pub model_reason: Option<String>,
}

ProviderSetupWizard::test_connection(url, key, model) -> ConnectionTestResult
```

The test makes **no network call**. It validates exactly what the owner typed:

- the URL is absolute `http`/`https` with a host and no whitespace;
- the key is non-empty and free of whitespace;
- the model id is non-empty.

Each `*_ok` flag is `true` exactly when its `*_reason` is `None`, so the UI can show three
checkmarks and, next to each cross, the sentence that explains it. Collapsing these into one
"connection failed" message is what makes setup painful, so they stay separate. Reachability
is a different question and belongs to the adapters' existing `health()`.

Keeping the check offline is also why the wizard is testable: the desktop component
`testConnection()` mirrors the same three rules and returns the same snake_case shape, so a
real daemon result can be dropped straight into the component.

### What is not here yet

- The desktop components are standalone: they are not mounted in `App.tsx` or the run view
  yet, and no RPC surface persists Eco mode or per-task defaults.
- `RouterTarget`/`EcoMode`/`PerTaskDefaults` are decisions, not plumbing: `ProviderRouter`
  does not consult them yet, so a run still follows the role routing.
- Battery and network values come from the caller; no sensor or probe is wired.
- The wizard saves nothing: `onSave` is the seam a settings RPC would plug into.
