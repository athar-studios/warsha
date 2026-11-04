# تثبيت ورشة وتشغيلها — Warsha install and run

<div dir="rtl">

## ١. ما هذا الملف

هذا الملف يشرح أمرين فقط: كيف تبني مُثبِّت ورشة على ويندوز، وكيف يثبّته المالك ويشغّله.
لا يفترض أي معرفة بلغة Rust. الأوامر مكتوبة كما شُغّلت فعلًا على جهاز ويندوز واحد، ومعها
ما ظهر من مخرجات.

**اقرأ هذا أولًا: لا يوجد اليوم ملف لتثبيته.** لم يُبنَ أي مُثبِّت على الجهاز الذي يُصان
عليه هذا المستودع (Linux aarch64، وأغلفة MSI/NSIS لا تُنتَج إلا على ويندوز)، ولا يوجد في
المستودع وسم إطلاق (release tag) ولا إصدار منشور، فالأمر `git tag --list` يعيد صفرًا.
الأوامر والمخرجات أدناه مقيسة على جهاز ويندوز في ٢٠٢٦-١٠-٣١ (المجموعة M20 في
`PROGRESS.md`)، وهو جهاز لم يعد مستخدمًا؛ أي رقم حجم أو مسار مكتوب هنا هو أثر من ذلك
اليوم لا وعد بيوم قادم. القسم ٥ يعدّد ما ليس موصولًا بعد، وللمتابعين صفحة مستقلة:
[القيود المعروفة](src/known-limitations.md).

الحالة الحالية بصراحة: المُثبِّت **غير موقّع رقميًا** (لا شهادة توقيع)، والتحديث الذاتي
**غير موصول** (إعداد `plugins.updater` موجود، لكن حزمة `tauri-plugin-updater` ليست تبعية بعد
ولا يوجد إصدار موقّع على GitHub). كل ما هو غير موصول مذكور في آخر هذا الملف وفي `PROGRESS.md`.

## ٢. بناء المُثبِّت (للمطوّر)

### المتطلبات

| المتطلب | لماذا | كيف تتحقق |
|---|---|---|
| Node.js 20 أو أحدث | تشغيل الواجهة (Vite/TypeScript) وأداة Tauri | `node --version` |
| pnpm 9 | مدير الحزم الذي يستخدمه المستودع (`packageManager: pnpm@9.0.0`) | `pnpm --version` |
| Rust (أداة `stable-x86_64-pc-windows-msvc`) | بناء نواة التطبيق بلغة Rust | `rustup toolchain list` |
| Visual Studio Build Tools 2022 مع Windows SDK | `cl.exe` والربّاط الذي تحتاجه سلسلة MSVC | وجود `vcvars64.bat` |
| WebView2 Runtime | نافذة التطبيق نفسها (موجود في ويندوز ١٠/١١ الحديثة) | `Microsoft Edge WebView2 Runtime` في «التطبيقات» |
| اتصال بالإنترنت في أول بناء | تنزيل حزم Rust من crates.io، و WiX/NSIS لأداة التغليف | — |

إن لم يكن `pnpm` مثبتًا: `npm i -g pnpm@9.0.0`، أو نادِه مباشرةً بدون تثبيت:
`npx pnpm@9.0.0 install`. على الجهاز الذي يُصان عليه المستودع اليوم (Linux aarch64،
Node‏ v22.23.2) لا يوجد `pnpm` أصلي في المسار، بل غلاف في `/home/dev/.local/bin/pnpm`
مضمونه `exec npx --yes pnpm@9.0.0 "$@"`؛ أي أن كل سطر `pnpm ...` مكتوب في هذا الملف يساوي
`npx pnpm@9.0.0 ...` هناك. أما CI فيتثبّت على Node 20 (`release.yml`، وإعلان المستودع في
`package.json` هو `engines.node: ">=20.0.0"`).

### الأوامر

من جذر المستودع:

```powershell
pnpm install
pnpm --filter warsha-desktop tauri build
```

`tauri build` يشغّل أولًا `pnpm build` داخل `apps/desktop` (أي `tsc && vite build`) ليبني الواجهة
إلى `apps/desktop/dist`، ثم يبني `apps/desktop/src-tauri` بلغة Rust، ثم يغلّف الناتج.

الأمر الذي شُغّل فعلًا على الجهاز الذي بُني عليه هذا الإصدار (سلسلته الافتراضية GNU، فأُضيفت
السلسلة وهدف البناء صراحةً — وهذان الخياران لا يغيّران الناتج، لكنهما يجعلان المسارات تحمل اسم
الهدف كما في مسارات CI):

```powershell
cmd /c "call \"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat\" >nul && set \"RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-msvc\" && pnpm --filter warsha-desktop tauri build --target x86_64-pc-windows-msvc"
```

(ملاحظة مقيسة: في `cmd` يجب كتابة `set "المتغير=القيمة"` بعلامات تنصيص، وإلا صارت القيمة
`stable-x86_64-pc-windows-msvc ` بمسافة زائدة ورفضها `cargo` برسالة
`override toolchain ... is not installed`.)


**تنبيه مهم عن السلسلة الافتراضية (مقيس على الجهاز الذي بُني عليه هذا الإصدار):** إذا كانت
السلسلة الافتراضية في `rustup` هي `stable-x86_64-pc-windows-gnu` ولا يوجد `gcc`/`mingw`، يفشل
البناء. استخدم سلسلة MSVC، وإذا كانت الافتراضية غيرها شغّل البناء داخل بيئة MSVC:

```powershell
cmd /c "call \"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat\" >nul && cargo +stable-x86_64-pc-windows-msvc build --release --target x86_64-pc-windows-msvc"
```

أو ببساطة اجعل MSVC هي الافتراضية:

```powershell
rustup default stable-x86_64-pc-windows-msvc
```

و**لا تحاول بناء نمط التصحيح (`debug`)** على جهاز كهذا: حزمة `ring` لا تُبنى في نمط التصحيح
هناك، وتفشل برسالة
`cl : Command line error D8050 : cannot execute ... c1.dll: failed to get command line into debug records`.
نمط `release` هو ما ينتجه أمر التغليف أصلًا، وهو الذي نجح.

### أين تظهر الملفات (وبأي أسماء)

**لا يوجد أي من هذه الملفات الآن.** الجدول قالب لا مخزن: الأسماء هي ما سينتجه المُغلِّف عند
الإصدار الحالي، وذاك `0.2.0` لا `0.1.0` (`apps/desktop/src-tauri/tauri.conf.json:4`)، وهي
الأسماء نفسها التي يبحث بها ملف إطلاق CI عن المخرجات
(`.github/workflows/release.yml:209-210`: ‏`Warsha_*_x64_en-US.msi` و `Warsha_*_x64-setup.exe`).
المسارات تُنسب إلى اسم الـ binary كما يعرّفه `apps/desktop/src-tauri/Cargo.toml`.

| الملف | المسار الذي سيظهر فيه عند البناء | حالته اليوم | ما قيس فعلًا (٢٠٢٦-١٠-٣١، جهاز ويندوز لم يعد مستخدمًا) |
|---|---|---|---|
| التطبيق التنفيذي | `apps/desktop/src-tauri/target/x86_64-pc-windows-msvc/release/warsha-desktop.exe` | غير مبنيّ: لا يُنتَج exe على هذا الجهاز (Linux aarch64) | ٢١٬٤٥٩٬٤٥٦ بايت، مدوّن في `PROGRESS.md` |
| مُثبِّت MSI | `.../release/bundle/msi/Warsha_0.2.0_x64_en-US.msi` | غير مبنيّ، ولا وسم إطلاق ولا إصدار منشور | اسمه حينها `Warsha_0.1.0_x64_en-US.msi`، ووزنه ٨٬٠٨٥٬٥٠٤ بايت (٧٫٧١ م.ب) |
| مُثبِّت NSIS | `.../release/bundle/nsis/Warsha_0.2.0_x64-setup.exe` | غير مبنيّ، والشرط نفسه | اسمه حينها `Warsha_0.1.0_x64-setup.exe`، ووزنه ٥٬٧٢٦٬٨٣٤ بايت (٥٫٤٦ م.ب) |

الأوزان في العمود الأخير بقايا ذلك البناء عند `0.1.0`، لا وعد: بناء عند `0.2.0` ينتج أوزانًا
أخرى، ولا ملف منشور يحمل أيًّا من الاسمَين، فأي رابط من نوع
`.../releases/latest/download/...` إلى أحدهما ينتهي بـ 404.

أول تغليف يحتاج إنترنت: تنزّل أداة Tauri ملفات WiX (‏`wix314-binaries.zip`) و NSIS
(‏`nsis-3.13.zip` و `nsis_tauri_utils.dll`) مرة واحدة إلى `%LOCALAPPDATA%\tauri`. هذه أسماء ما
نزّله ذلك الإصدار من أداة Tauri في ذلك اليوم؛ الأسماء تتغير مع تغير إصدار الأداة، فاحكم عليها
بمخرجات بنائك لا بهذا السطر. بدون إنترنت يفشل التغليف وحده، ويبقى الملف التنفيذي في مكانه
صالحًا للتشغيل المباشر.

### التحقق من التطبيق دون فتح نافذة

الأمران أدناه يُشغَّلان على ملف مُبنِيّ حديثًا، ولا يوجد مثل هذا الملف على هذا الجهاز اليوم؛ الشكل
التالي مأخوذ من الشيفرة (`apps/desktop/src-tauri/src/main.rs:13-24`) لا من تشغيل:

```powershell
warsha-desktop.exe --self-check
warsha-desktop.exe --self-check --data-dir C:\Temp\warsha-check
```

يبدأ هذا الأمر الخادم `warshad` كما تفعل النافذة تمامًا، ثم يتحقق ويطبع سطر `PASS` أو `FAIL`
لكل فحص: أن استدعاء JSON-RPC برمز صحيح يُجاب (`projects.list`)، وأن رمزًا خاطئًا يُرفض، وأن طلب
CORS التمهيدي من أصل النافذة (`http://tauri.localhost`) يُجاب — ثم يوقف الخادم ويذكر أن القفل
حُرِّر (`apps/desktop/src-tauri/src/lib.rs:438-489`). ومع `--data-dir` يُضاف فحص رابع: أن خادمًا
واحدًا يمسك المجلد وأن إعادة التشغيل تسته بعد إيقافه (`:494-504`). صيغة `--data-dir` هي وحدها
التي تلمس ذلك الفحص، لأنها وحدها التي تبدأ وتوقف أكثر من خادم على نفس المجلد؛ وهي لا تلمس بيانات
المالك: تنقل قاعدة البيانات والقفل ومقبس الاتصال إلى ذلك المجلد وتأخذ منافذ يختارها النظام
(`:396-412`)، فهي الصيغة المناسبة لفحص تثبيت على جهاز غير جهازك.

**لا تخلط هذا بخادم الطرفية.** `--data-dir` خيار لـ `warsha-desktop` عند `--self-check` فقط؛
الخادم المستقل `warshad` لا يعرفه إطلاقًا — خياراته الخمسة هي `--config` و `--foreground` و
`--http-port` و `--ws-port` و `--socket` (`crates/warshad/src/lib.rs:472-492`)، وتمرير أي خيار
آخر خطأ يرفضه البرنامج. مجلد بيانات `warshad` هو مفتاح `data_dir` داخل `config.toml`، لا علملية
على سطر الأوامر.


## ٣. التثبيت (للمالك)

لا يوجد ما يُثبَّت بعد: لا إصدار منشور ولا وسم ولا ملف ( انظر القسم ١). ما يلي هو الترتيب الذي
سيلعبه المالك حين يوجد مُغلَّف، وهو مكتوب من الشيفرة لا من تثبيت مُشاهَد: مُثبِّتا ٢٠٢٦-١٠-٣١
بُنيا لكن **لم يُشغَّل واجهةُ أيٍّ منهما قطّ** (قائمة «ما لم يُتحقق منه» في `PROGRESS.md` لذلك
الفوج)، فليس وراء أي خطوة أدناه شاشة رآها أحد. أسماء الملفات تحمل رقم الإصدار، لذا كُتبت هنا على
هيئة نمط:

1. شغّل أحد الملفين: `Warsha_<version>-setup.exe` (مُثبِّت NSIS) أو `Warsha_<version>_x64_en-US.msi`،
   ورقم الإصدار اليوم هو `0.2.0`. كلاهما يُثبِّت للمستخدم الحالي دون صلاحيات مدير.
2. لأن الملفات غير موقّعة، يُتوقَّع أن يظهر تحذير Windows SmartScreen («Windows protected your PC»).
   اختر `More info` ثم `Run anyway`. هذا هو الأثر الوحيد لغياب شهادة التوقيع — متوقَّع من غياب
   التوقيع، لا من مشاهدته على تثبيت حقيقي.
3. شغّل «Warsha» من قائمة ابدأ.
4. أول تشغيل يعرض شاشة الإعداد: اختر اللغة، أضف مزوّد ذكاء اصطناعي ومفتاحه، ثم سمِّ مشروعك الأول.
   المفتاح يذهب إلى خزنة النظام — خزنة ويندوز (Windows Credential Manager) على هذا الجهاز — ولا
   يُكتب في أي ملف نصي. الشرح الكامل خطوة بخطوة، على أي نظام تشغيل:
   [إدخال مفتاح المزوّد أول مرة](src/first-run.md). آخر خطوة في ذلك المعالج ترسل اليوم الحقول الثلاثة
   التي يربطها الخادم — الاسم، والاسم نفسه وصفًا، ولغةُ الواجهة الفعّالة
   (`apps/desktop/src/screens/Onboarding.tsx:266` مع `crates/warshad/src/lib.rs:668-674`) — فلم تعد
   تلك الخطوة هي التي يرفضها خادمٌ حيّ بـ `-32602 missing field 'description'` ثم بـ `'language'`، وهو
   ما كان مقيسًا عليه في ٢٠٢٦-١١-٠٣ ([القيود المعروفة](src/known-limitations.md)).

### ما يفعله التطبيق عند التشغيل

- يقرأ إعدادات الخادم من `%APPDATA%\warsha\config.toml`، وينشئه عند أول تشغيل برمز من ٣٢ بايت
  عشوائيًا (مُرمَّز base64، `crates/warshad/src/lib.rs:3492-3499`).
- يشغّل الخادم `warshad` داخل العملية نفسها، ثم يسلّم الواجهة عنوانه ورمزه.
- عند إغلاق النافذة يُوقف الخادم وينتظر أبناءه، ويحرّر ملف القفل `warshad.lock`.

### أين تُحفظ البيانات

| المحتوى | المسار |
|---|---|
| إعدادات الخادم ورمزه | `%APPDATA%\warsha\config.toml` |
| قاعدة البيانات والمشاريع | `%APPDATA%\warsha\warsha.db` |
| تفضيلات الواجهة (`onboarding_complete`, `app_mode`) | `%APPDATA%\warsha\desktop.json` |
| سجل أخطاء تشغيل التطبيق | `%APPDATA%\warsha\desktop.log` |
| التطبيق نفسه | تحت `%LOCALAPPDATA%`، والموضع الدقيق اختيار أداة التغليف — لم يُرَ قطّ، لأن أياً من المُثبِّتين لم يُشغَّل |

الأربعة الأولى مكتوبة من الشيفرة: `data_dir` هو المجلد الذي تُكتب فيه كلُّها
(`apps/desktop/src-tauri/src/lib.rs:290-298` و `:601-602`، و `crates/warshad/src/lib.rs:3157`)،
وهو على ويندوز `%APPDATA%\warsha`. غيّره بمفتاح `data_dir` داخل `config.toml` — لا توجد علملية
لذلك في `warshad`.

### إلغاء التثبيت

من «الإعدادات ← التطبيقات ← التطبيقات المثبتة» اختر Warsha ثم «إلغاء التثبيت». أو بالـ MSI
(اسمه يحمل رقم الإصدار، ولا MSI موجود ليُزال بعد):

```powershell
msiexec /x "Warsha_<version>_x64_en-US.msi"
```

لا يحذف إلغاء التثبيت مجلد `%APPDATA%\warsha`؛ احذفه يدويًا إذا أردت مسح المشاريع والمفاتيح
(المفاتيح نفسها تبقى في خزنة ويندوز تحت اسم الخدمة `warsha-provider`).

## ٤. حل المشكلات

| ما تراه | السبب المحتمل | ما تفعله |
|---|---|---|
| التطبيق يفتح لكن لا يجد الخادم | لم يبدأ `warshad` (منفذ 8765/8766 مشغول ببرنامج آخر، أو ملف القفل ممسوك) | افتح `%APPDATA%\warsha\desktop.log`؛ التطبيق يعيد المحاولة مرة واحدة على منافذ يختارها النظام |
| فشل البناء: `cl.exe not found` | سلسلة Rust الافتراضية GNU أو بيئة MSVC غير محمّلة | `rustup default stable-x86_64-pc-windows-msvc` أو شغّل البناء عبر `vcvars64.bat` |
| فشل البناء: `D8050 ... c1.dll` | بناء نمط `debug` لحزمة `ring` على هذا الجهاز | ابنِ `--release` فقط |
| فشل التغليف: تعذّر تنزيل WiX/NSIS | لا إنترنت في أول تغليف | وصّل الإنترنت أو استخدم `--bundles nsis`، وأبقِ الملف التنفيذي كبديل |
| تحذير SmartScreen | لا شهادة توقيع | `More info` ← `Run anyway` |

## ٥. ما ليس في هذا الإصدار بعد

- **لا إصدار أصلًا**: لا وسم إطلاق ولا صفحة تنزيل ولا ملف مُثبِّت مبنيّ على جهاز الصيانة
  (القسم ١). هذا القسم يصف شيفرة المستودع، لا شيء منشورًا.
- **التوقيع**: لا شهادة، لذلك تحذير SmartScreen في كل تثبيت.
- **التحديث الذاتي**: `plugins.updater` مضبوط، لكن حزمة `tauri-plugin-updater` ليست تبعية بعد
  ولا يوجد `latest.json` موقّع، فلا شيء يُحدَّث تلقائيًا.
- **بث الأحداث في الواجهة**: نقطة `/events` تتطلب رأس `Authorization`، ومتصفح النافذة لا
  يستطيع إرساله عند فتح مقبس WebSocket، فالتطبيق يعمل لكل استدعاءات JSON-RPC دون البث الحيّ.
  الطرف الذي يُسلّمه الواجهة يرسل الرمز بالفعل داخل بروتوكول فرعي (`warsha.token.<token>` في
  `packages/client/src/index.ts:445` عند `:1095`)، لكن وسيط HTTP في الخادم يقرأ رأس
  `Authorization` وحده (`crates/warshad/src/lib.rs:3658`، عبر `bearer_token` عند `:365-372`) فيرفض
  المقبس بـ 401.
- **منافذ ثابتة**: إن كان 8765/8766 مشغولًا يختار النظام منافذ أخرى، ولا يعرفها سطر أوامر
  `warsha` بعد ذلك.
- **معرّف الحزمة**: القيمة الحالية `dev.warsha.app` تنتهي بـ `.app`، وتنبّه أداة Tauri إلى
  تعارضها مع امتداد حزمة macOS؛ تغييرها لاحقًا يغيّر هوية المُثبِّت، فالأفضل تغييرها قبل أول
  إصدار عام (`dev.warsha.desktop` مثلًا).

هذا القسم هو مصدر قائمة القيود؛ صارت هناك صفحة قابلة للتنقل تجمعها مع ما قيس على خادم حيّ:
[القيود المعروفة](src/known-limitations.md).

</div>

---

# Warsha — install and run (English)

## 1. What this file is

Two things: how to build the Windows installer, and how an owner installs and runs the result.
No Rust knowledge is assumed. The commands are the ones actually run on one Windows host, with
what they printed.

**Read this first: there is no file to install today.** No installer has been built on the host
this repository is maintained on (Linux aarch64 — MSI and NSIS bundles can only be produced on
Windows), there is no release tag and no published release, and `git tag --list` returns nothing.
The commands and outputs below were measured on a Windows host on 2026-10-31 (the M20 batch in
`PROGRESS.md`), a host no longer in use; every byte size and path quoted here is an artefact of
that day, not a promise about the next one. §5 lists what is not wired yet, and there is a
separate navigable page for the same list: [Known limitations](src/known-limitations.md).

Honest status: the installer is **unsigned** (no code-signing certificate) and **self-update is not
wired** — the `plugins.updater` config exists, but `tauri-plugin-updater` is not a dependency yet
and no signed `latest.json` exists. Everything that is missing is listed in §5 here and in
`PROGRESS.md`.

## 2. Building the installer (developer)

### Prerequisites

| Requirement | Why | Check |
|---|---|---|
| Node.js 20+ | the frontend (Vite/TypeScript) and the Tauri CLI | `node --version` |
| pnpm 9 | the package manager this repo pins (`packageManager: pnpm@9.0.0`) | `pnpm --version` |
| Rust, the `stable-x86_64-pc-windows-msvc` toolchain | builds the Rust half | `rustup toolchain list` |
| Visual Studio Build Tools 2022 + Windows SDK | `cl.exe` and the linker MSVC needs | `vcvars64.bat` exists |
| WebView2 runtime | the app window itself (present on current Windows 10/11) | "Microsoft Edge WebView2 Runtime" in Apps |
| Network access for the first build | downloads Rust crates, and WiX/NSIS for the bundler | — |

If pnpm is missing: `npm i -g pnpm@9.0.0`, or call it without installing it at all:
`npx pnpm@9.0.0 install`. On the host this repository is maintained on today (Linux aarch64,
Node v22.23.2) there is no native pnpm on the `PATH`: `/home/dev/.local/bin/pnpm` is a shell
wrapper whose whole body is `exec npx --yes pnpm@9.0.0 "$@"`, so every plain `pnpm ...` line in
this file means `npx pnpm@9.0.0 ...` there. CI pins Node 20 (`release.yml`), and the repository's
own declaration is `engines.node: ">=20.0.0"` in `package.json`.

### Commands

From the repository root:

```powershell
pnpm install
pnpm --filter warsha-desktop tauri build
```

`tauri build` first runs `pnpm build` inside `apps/desktop` (`tsc && vite build`) to write the
frontend to `apps/desktop/dist`, then builds `apps/desktop/src-tauri` in Rust, then bundles it.

The command actually run on the host this release was built on — its default toolchain is the GNU
one, so the toolchain and the target were named explicitly. Neither changes the output; together
they put the target triple in the paths, which is what CI's paths look like too:

```powershell
cmd /c "call \"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat\" >nul && set \"RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-msvc\" && pnpm --filter warsha-desktop tauri build --target x86_64-pc-windows-msvc"
```

(Measured note: in `cmd`, write `set "VAR=value"` with the quotes, or the value becomes
`stable-x86_64-pc-windows-msvc ` with a trailing space and `cargo` refuses it with
`override toolchain ... is not installed`.)

**A measured warning about the Rust toolchain:** if `rustup`'s *default* toolchain is
`stable-x86_64-pc-windows-gnu` and the machine has no `gcc`/`mingw`, the build fails there. Use the
MSVC toolchain, and if the default is the GNU one, build inside the MSVC environment:

```powershell
cmd /c "call \"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat\" >nul && cargo +stable-x86_64-pc-windows-msvc build --release --target x86_64-pc-windows-msvc"
```

or simply make MSVC the default:

```powershell
rustup default stable-x86_64-pc-windows-msvc
```

Do **not** try the `debug` profile on such a host: `ring` cannot be built in it there and fails with
`cl : Command line error D8050 : cannot execute ... c1.dll: failed to get command line into debug records`.
`release` is what the bundler produces anyway, and it is the profile that works.

### Where the files land (and under which names)

**None of these files exists now.** The table is a template, not a shelf: the names are what the
bundler produces at the current version, and that version is `0.2.0`, not `0.1.0`
(`apps/desktop/src-tauri/tauri.conf.json:4`); they are also the names the release workflow looks
for when it collects artifacts (`.github/workflows/release.yml:209-210`: `Warsha_*_x64_en-US.msi`
and `Warsha_*_x64-setup.exe`). The paths come from the binary name declared in
`apps/desktop/src-tauri/Cargo.toml`.

| File | Path it would be built at | Status today | What was actually measured (2026-10-31, a Windows host no longer in use) |
|---|---|---|---|
| The executable | `apps/desktop/src-tauri/target/x86_64-pc-windows-msvc/release/warsha-desktop.exe` | not built — an `.exe` cannot be produced on this host (Linux aarch64) | 21,459,456 bytes, recorded in `PROGRESS.md` |
| MSI installer | `.../release/bundle/msi/Warsha_0.2.0_x64_en-US.msi` | not built, and there is no release tag and no published release | then named `Warsha_0.1.0_x64_en-US.msi`, 8,085,504 bytes (7.71 MiB) |
| NSIS installer | `.../release/bundle/nsis/Warsha_0.2.0_x64-setup.exe` | not built, same condition | then named `Warsha_0.1.0_x64-setup.exe`, 5,726,834 bytes (5.46 MiB) |

The sizes in the last column are leftovers of that `0.1.0` build, not a promise: a build at
`0.2.0` weighs something else, no published file carries either name, and any
`.../releases/latest/download/...` link to one of them is a 404.

The first bundle needs a network: the Tauri CLI downloads WiX (`wix314-binaries.zip`) and NSIS
(`nsis-3.13.zip` and `nsis_tauri_utils.dll`) once into `%LOCALAPPDATA%\tauri`. Those are the names
the Tauri CLI of that day fetched; the names move with the CLI version, so judge them by your own
build output rather than by this line. Without a network, only the bundling step fails; the
executable is still there and can be run directly.

### Verifying an install without a window

Both commands below act on a freshly built file, and no such file exists on this host today; the
shape is read from the code (`apps/desktop/src-tauri/src/main.rs:13-24`), not from a run:

```powershell
warsha-desktop.exe --self-check
warsha-desktop.exe --self-check --data-dir C:\Temp\warsha-check
```

That starts the `warshad` daemon exactly as the window does and then prints a `PASS` or `FAIL`
line per check: an authorized JSON-RPC call (`projects.list`) is answered, a wrong token is
refused, and the CORS preflight from the webview's own origin (`http://tauri.localhost`) is
answered — then it stops the daemon and reports that the lock was released
(`apps/desktop/src-tauri/src/lib.rs:438-489`). With `--data-dir` a fourth check is added: that one
daemon holds the directory and a restart gets it back (`:494-504`). Only the `--data-dir` form
runs that fourth check, because it is the only form that starts and stops more than one daemon
over one directory; and it is the form that leaves the owner's data alone — it moves the database,
the lock and the socket into the scratch directory and takes OS-chosen ports (`:396-412`), which
is what a check on someone else's machine wants.

**Do not carry this over to the standalone daemon.** `--data-dir` is an option of
`warsha-desktop --self-check` and nothing else; `warshad` does not know it — its five flags are
`--config`, `--foreground`, `--http-port`, `--ws-port` and `--socket`
(`crates/warshad/src/lib.rs:472-492`), and an unknown flag is a refusal, not something to ignore.
The daemon's data directory is the `data_dir` key inside `config.toml`, never a command-line
switch.

## 3. Installing (owner)

There is nothing to install yet — no published release, no tag, no artifact (see §1). What follows
is the sequence an owner will run once a bundle exists, and it is written from the code rather than
from an observed install: the 2026-10-31 installers were built but **never run through their UI**
(`PROGRESS.md`, that batch's own "not verified" list), so no step below has a screenshot behind it.
The file names carry the version, so they are written as a pattern here.

1. Run either `Warsha_<version>-setup.exe` (NSIS) or `Warsha_<version>_x64_en-US.msi` — today that
   version is `0.2.0`. Both install for the current user and need no administrator rights.
2. Because the files are unsigned, Windows SmartScreen is expected to show "Windows protected your
   PC". Choose `More info`, then `Run anyway`. That warning is the only consequence of the missing
   certificate — expected from the absence of a signature, not observed on a real install.
3. Start **Warsha** from the Start menu.
4. The first run shows the setup screen: pick the language, add an AI provider and its key, then
   name the first project. The key goes to the OS keychain — on Windows, Credential Manager — and
   never into a file. The full walkthrough, on any operating system, is
   [First run: adding your provider key](src/first-run.md). The last step of that wizard sends all
   three fields the daemon binds — the name typed on the step, that name again as `description`, and
   the active `@warsha/i18n` locale as `language` (`apps/desktop/src/screens/Onboarding.tsx:266`,
   against `crates/warshad/src/lib.rs:668-674`) — so it is no longer the step a live daemon refused
   with `-32602 missing field 'description'` and then `'language'`, which is what was measured on it
   on 2026-11-03 ([Known limitations](src/known-limitations.md)).

### What the app does when it starts

- Reads the daemon configuration from `%APPDATA%\warsha\config.toml`, creating it with 32 fresh
  random bytes as its token (base64-encoded, `crates/warshad/src/lib.rs:3492-3499`) on the very
  first run.
- Starts the `warshad` daemon *inside its own process*, then hands the webview the address and the
  token it is listening on.
- On closing the window it stops the daemon, waits for its children, and releases the
  `warshad.lock` file.

### Where the data lives

| Content | Path |
|---|---|
| Daemon configuration and token | `%APPDATA%\warsha\config.toml` |
| Database and projects | `%APPDATA%\warsha\warsha.db` |
| UI preferences (`onboarding_complete`, `app_mode`) | `%APPDATA%\warsha\desktop.json` |
| Startup log | `%APPDATA%\warsha\desktop.log` |
| The app itself | under `%LOCALAPPDATA%`, where exactly being the bundler's choice — never observed, because no installer has been run |

The first four rows are read from the code: `data_dir` is the directory all four are written into
(`apps/desktop/src-tauri/src/lib.rs:290-298`, `:601-602`, `crates/warshad/src/lib.rs:3157`), and on
Windows `data_dir` resolves to `%APPDATA%\warsha`. Change it with the `data_dir` key in
`config.toml` — there is no `warshad` flag for it.

### Uninstalling

Settings → Apps → Installed apps → Warsha → Uninstall, or through the MSI (its name carries the
version, and no MSI exists to remove yet):

```powershell
msiexec /x "Warsha_<version>_x64_en-US.msi"
```

Uninstalling leaves `%APPDATA%\warsha` in place: delete it by hand to remove the projects and the
daemon configuration. Provider keys stay in the Windows Credential Manager under the service name
`warsha-provider`.

## 4. Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| The app opens but finds no daemon | `warshad` did not start (ports 8765/8766 already taken, or the data directory is locked) | read `%APPDATA%\warsha\desktop.log`; the shell retries once on OS-chosen ports |
| Build fails with `cl.exe not found` | the default Rust toolchain is GNU, or MSVC is not loaded | `rustup default stable-x86_64-pc-windows-msvc`, or build through `vcvars64.bat` |
| Build fails with `D8050 ... c1.dll` | a `debug` build of `ring` on this host | build `--release` only |
| Bundling fails: WiX/NSIS could not be downloaded | no network on the first bundle | get a network, or use `--bundles nsis`, and keep the executable as the fallback |
| SmartScreen warning | no code-signing certificate | `More info` → `Run anyway` |

## 5. Not in this build yet

- **There is no release at all**: no tag, no release page, no installer built on the maintenance
  host (§1). Everything in this section describes the source tree, not a published thing.
- **Signing**: no certificate, so SmartScreen warns on every install.
- **Self-update**: `plugins.updater` is configured, but `tauri-plugin-updater` is not a dependency
  and no signed `latest.json` is published, so nothing updates itself.
- **Event stream in the webview**: `/events` requires an `Authorization` header, which a browser
  cannot send when opening a WebSocket, so the app does every JSON-RPC call live but not the live
  event feed. The client does hand the daemon a credential — it puts the token in a WebSocket
  subprotocol (`warsha.token.<token>`, `packages/client/src/index.ts:445`, used at `:1095`) — but
  the daemon's HTTP middleware authenticates from the `Authorization` header alone
  (`crates/warshad/src/lib.rs:3658`, and `bearer_token` reads nothing else at `:365-372`), so the
  socket is refused with 401.
- **Fixed ports**: when 8765/8766 are taken the OS picks others, and the `warsha` CLI does not know
  about them afterwards.
- **Bundle identifier**: the current value `dev.warsha.app` ends in `.app`, which Tauri warns clashes
  with the macOS bundle extension. Changing it later changes the installer's identity, so it is
  cheapest to change it before the first public release (e.g. `dev.warsha.desktop`).

This section is the source list for the limitations; they now also have a navigable page that adds
what was measured against a running daemon: [Known limitations](src/known-limitations.md).
