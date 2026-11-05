# تثبيت ورشة وتشغيلها — Warsha install and run

<div dir="rtl">

## ١. ما هذا الملف

هذا الملف يشرح كيف تبني مُثبِّت ورشة على ويندوز (NSIS، غير موقّع)، وكيف يثبّته المالك
بصمت، ويتحقق منه دون فتح نافذة، ثم يزيله. لا يفترض أي معرفة بلغة Rust.

**الحالة المقيسة (٢٠٢٦-١١-٠٥، جهاز ويندوز، سلسلة أدوات `stable-x86_64-pc-windows-msvc`، rustc 1.99.1):**
بُني مُثبِّت NSIS عند الإصدار `0.2.0` على هذا الجهاز فعلًا، وشُغّل بصمت من سطر الأوامر، ونُفّذ
الملف المثبّت بأمر `--self-check` على مجلد بيانات مؤقت فأنتجت كل الفحوصات `PASS`، ثم أُلغي
التثبيت بصمت وحُذف الملف التنفيذي. الأوزان وقيم SHA-256 والمسارات في القسمين ٢ و٥ مقيسة في ذلك
التشغيل، لا نموذج تنبؤي. ومع ذلك: **لا يوجد إصدار منشور** — لا وسم إطلاق ولا صفحة تنزيل؛ كل ما
قيس هنا تثبيت محلي على جهاز البناء نفسه.

الحالة بصراحة: المُثبِّت **غير موقّع رقميًا** (لا شهادة توقيع)، و**التحديث الذاتي مطفأ في
الشيفرة الآن**: كان `bundle.createUpdaterArtifacts` مضبوطًا على `true` مع كتلة `plugins.updater`
نشطة، وكان ذلك يجعل `tauri build` يطلب `TAURI_SIGNING_PRIVATE_KEY` أو يُخرج حزمة تشير إلى نقطة
تحديث لا تنشر أي أثر؛ صارت القيمة اليوم `false` وأصبحت الكتلة `{}` (ويُثبت اختبار وحدة في
`apps/desktop/src-tauri/src/lib.rs` باسم
`the_shipped_config_builds_unsigned_and_ships_no_active_updater` أن الملف لا يمكن أن ينفلت من هذا
الضبط لاحقًا). لم تُبنَ حزمة MSI في هذا التشغيل (بُني `--bundles nsis` وحده).

## ٢. بناء المُثبِّت (للمطوّر)

### المتطلبات

| المتطلب | لماذا | كيف تتحقق |
|---|---|---|
| Node.js 20 أو أحدث | تشغيل الواجهة (Vite/TypeScript) وأداة Tauri | `node --version` |
| pnpm 9 | مدير الحزم الذي يستخدمه المستودع (`packageManager: pnpm@9.0.0`) | `pnpm --version` |
| Rust، سلسلة `stable-x86_64-pc-windows-msvc` | بناء نواة التطبيق بلغة Rust | `rustup show` (يجب أن تكون active/default) |
| Visual Studio Build Tools 2022 مع Windows SDK | `cl.exe` والربّاط الذي تحتاجه سلسلة MSVC | وجود `vcvars64.bat` |
| WebView2 Runtime | نافذة التطبيق نفسها (موجود في ويندوز ١٠/١١ الحديثة) | `Microsoft Edge WebView2 Runtime` في «التطبيقات» |
| NSIS (أداة `makensis.exe`) | تغليف مُثبِّت NSIS | `%LOCALAPPDATA%\tauri\NSIS\makensis.exe` |

إن لم يكن `pnpm` مثبتًا: `npm i -g pnpm@9.0.0`، أو نادِه مباشرةً بدون تثبيت:
`npx pnpm@9.0.0 install`. أداة Tauri تنزّل NSIS مرة واحدة إلى `%LOCALAPPDATA%\tauri`؛ على الجهاز
الذي قيس هذا التشغيل كان `makensis.exe` (NSIS v3.13) مخزّنًا هناك فعلًا فلم يحتج التغليف إلى
إنترنت. إن لم يكن مخزّنًا فستحتاج أول عملية تغليف إلى اتصال.

### الأوامر (كما شُغّلت فعلًا في ٢٠٢٦-١١-٠٥)

من جذر المستودع، داخل Git Bash على جهاز ويندوز (سلسلة MSVC هي الافتراضية، فلم تحتج الأوامر إلى
غلاف `vcvars64.bat`):

```bash
pnpm install --frozen-lockfile
pnpm --filter warsha-desktop tauri build --bundles nsis
```

`tauri build` يشغّل أولًا `pnpm build` داخل `apps/desktop` (أي `tsc && vite build`) ليبني الواجهة
إلى `apps/desktop/dist`، ثم يبني `apps/desktop/src-tauri` بنمط `release`، ثم يغلّف الناتج بـNSIS.
لا يُمرَّر `TAURI_SIGNING_PRIVATE_KEY` ولا حاجة إليه: مع قيم `tauri.conf.json` الحالية لا يطلب
البناء غير الموقّع مفتاحًا إطلاقًا.

إن كانت سلسلة Rust الافتراضية على جهازك `stable-x86_64-pc-windows-gnu` ولا يوجد `gcc`/`mingw`
يفشل البناء؛ اجعل MSVC افتراضية:

```powershell
rustup default stable-x86_64-pc-windows-msvc
```

ويبقى تحذير قديم مقيس على أجهزة معينة: لا تحاول نمط `debug` إن تعطلت فيه حزمة `ring` برسالة
`cl : Command line error D8050`؛ نمط `release` هو ما ينتجه أمر التغليف أصلًا وهو الذي نجح.

### أين تظهر الملفات — الأوزان وقيم SHA-256 المقيسة (٢٠٢٦-١١-٠٥)

| الملف | المسار | ما قيس فعلًا |
|---|---|---|
| التطبيق التنفيذي | `apps/desktop/src-tauri/target/release/warsha-desktop.exe` | ٢٣٬٦٧٣٬٨٥٦ بايت؛ SHA-256 `087f31a6298e26539c04b9d147b2849073bee5b38f40163c1c343de14ac3a47e` |
| مُثبِّت NSIS | `apps/desktop/src-tauri/target/release/bundle/nsis/Warsha_0.2.0_x64-setup.exe` | ٦٬٤٨٧٬٨٧٩ بايت (٦٫١٩ MiB)؛ SHA-256 `7e9c35d9433c86570fa399daf6bbfabe2c5984d0985a170e948e61d32c88369e` |

البناء بأمر يحمل `--target x86_64-pc-windows-msvc` يضع الملفين تحت
`target/x86_64-pc-windows-msvc/release/...` بدلًا من `target/release/...`؛ المخرجات هي هي.
هذه الأوزان تخصّ هذا البناء عند `0.2.0` على هذا الجهاز، ولا وعد بأنها تبقى: أي تعديل في الشيفرة
يغيّرها.

## ٣. التحقق دون فتح نافذة: `--self-check`

على الملف المبنيّ حديثًا (أو المثبَّت)، وعلى مجلد بيانات مؤقت لا يمس بيانات المالك:

```powershell
warsha-desktop.exe --self-check --data-dir C:\Temp\warsha-check
```

يبدأ الأمر الخادم `warshad` داخل العملية كما تفعل النافذة تمامًا، ثم يطبع سطر `PASS` أو `FAIL`
لكل فحص ويوقف الخادم. صيغة `--data-dir` هي الوحيدة التي تضيف فحصين لأنهما يكتبان ويبدآن ويوقفون
أكثر من خادم على نفس المجلد؛ وهي تنقل قاعدة البيانات والقفل والمقبس إلى المجلد المؤقت وتأخذ
منافذ يختارها النظام، فلا تلمس `%APPDATA%\warsha` إطلاقًا. المخرجات الكاملة المقيسة في
٢٠٢٦-١١-٠٥ من الملف **المثبَّت** (بعد التثبيت الصامت في القسم ٥):

```text
data dir: C:\Users\...\warsha-nsis-test\data
daemon:     http://127.0.0.1:63605 (started by this process: true)
events ws:  ws://127.0.0.1:63606
token:      43 bytes
PASS  an authorized JSON-RPC call answers
PASS  a wrong token is refused
PASS  the webview's CORS preflight is answered
PASS  GET /health on the daemon's HTTP port answers 200 with a healthy status
PASS  projects.create creates the smoke project
PASS  runs.start starts the smoke run at the Idea stage
PASS  gates.approve records the Gate A decision over RPC
PASS  runs.advance walks Idea -> GateA -> Research -> PrdSpec on the zero-key FakeProvider
PASS  the smoke run is waiting at Gate B
PASS  zero-key FakeProvider run produced research and prd_spec artifacts
daemon stopped (children reaped, lock released)
second daemon refused, as it must: another warshad holds "...\warsha-nsis-test\data\warshad.lock" (pid ...); this daemon will not share a data directory
PASS  one daemon holds the data directory, and a restart gets it back
self-check: OK
```

ماذا يعني فحص «مجرى FakeProvider بلا مفاتيح»؟ دورة كاملة فوق JSON-RPC دون أي مفتاح API:
يُنشأ مشروع `smoke-project`، ثم يبدأ تشغيل بفكرة عربية فيقف عند مرحلة Idea، ثم تُتّخذ بوابة A عبر
`gates.approve` (بإرسال `device_id: null` — فالمسجَّل هو الجهاز الذي صادقت عليه المواصل لا ما
يزعمه الطلب)، ثم يمشي `runs.advance` في `Idea -> GateA -> Research -> PrdSpec` ويتوقف منتظرًا
بوابة B المعلقة، وأخيرًا يؤكد `runs.artifacts` أن `idea` و`research` و`prd_spec` وُلدت ودُفنت —
وقد وُجدت فعلًا على القرص في `data\projects\<uuid>\factory\research.md` و`prd_spec.md`. تجيب
مراحلُ النموذج مجرّدَ `FakeProvider` الحتمي الذي لا يلمس الشبكة (المسار الثالث في توزيع
warsha-pipeline: لا مزوّد موجَّه ولا مفتاح بيئة)، ويضبط الفحص بنفسه `WARSHA_LLM_PROVIDER=fake`
فلا يقلب جهازٌ فيه `WARSHA_LLM_API_KEY` هذا الفحص إلى استدعاء نموذج مدفوع.

**لا تخلط هذا بخادم الطرفية.** `--data-dir` خيار لـ `warsha-desktop` عند `--self-check` فقط؛
الخادم المستقل `warshad` لا يعرفه — خياراته هي `--config` و`--foreground` و`--http-port`
و`--ws-port` و`--socket`، ومجلد بياناته مفتاح `data_dir` داخل `config.toml` لا علملية سطر أوامر.

## ٤. أول تشغيل: بلا مفاتيح، أو بـ`WARSHA_LLM_API_KEY`، أو بمزوّد مسجَّل

- **بلا أي ضبط (وهو مسار الاختبار أعلاه):** لا يرفض الخادم شيئًا. الأدوار غير الموجَّهة في خط
  الإنتاج تجيبها `FakeProvider` الحتمية غير المتصلة بالشبكة، فيستطيع مالك لم يسجّل مفتاحًا أن
  يرى دورة كاملة من الفكرة إلى البوابات.
- **بمفتاح بيئة:** إن ضبطت `WARSHA_LLM_API_KEY` (اختياريًا `WARSHA_LLM_BASE_URL` و`WARSHA_LLM_MODEL`)
  في بيئة العملية التي تشغّل التطبيق أو `warshad`، فالأدوار غير الموجَّهة تجيبها نهاية متوافقة
  مع OpenAI من تلك البيئة؛ ولإجبار المزوّد الحتمي رغم وجود المفتاح اضبط `WARSHA_LLM_PROVIDER=fake`.
  المفتاح هنا من البيئة لا من خزنة النظام، ولا يُكتب في ملف.
- **المزوّد المسجَّل من معالج الإعداد:** يذهب مفتاحه إلى خزنة ويندوز (Credential Manager) ولا
  يظهر في أي رد، وتوجيه الأدوار إليه يسبق المسارين أعلاه. الشرح خطوة بخطوة في
  [إدخال مفتاح المزوّد أول مرة](src/first-run.md).

## ٥. التثبيت الصامت وإلغاء التثبيت (كما شُغّلا فعلًا في ٢٠٢٦-١١-٠٥)

### التثبيت بصمت

المُثبِّت NSIS قياسي: `/S` للوضع الصامت، و`/D=<مسار>` — آخر الوسيط دائمًا وبلا علامات اقتباس
حوله — يختار المجلد. الشكلان اللذان عملا على الجهاز:

```powershell
# PowerShell (الشكل المفضل — وهو الذي قيس فعليًا)
Start-Process -FilePath "...\bundle\nsis\Warsha_0.2.0_x64-setup.exe" `
  -ArgumentList '/S', '/D=C:\Users\...\warsha-nsis-test\install' -Wait -PassThru
```

```text
cmd.exe /c "...\Warsha_0.2.0_x64-setup.exe /S /D=C:\Users\...\install"
```

(تحذير مقيس على هذا الجهاز: إن كان `cmd` المُحال من المسار ليس `cmd.exe` الحقيقي — كما حدث هنا
حيث أظلّ غلاف npm اسمه `cmd` المسار — فستظهر رسالة غريبة مثل
`error: too many arguments. Expected 1 argument but got 2.` لا علاقة لها بالمُثبِّت؛ نادِ
`%WINDIR%\System32\cmd.exe` بالاسم الكامل أو استخدم الشكل الأول.)

النتيجة المقيسة (خروج ٠): المجلد يضمّ `warsha-desktop.exe` (٢٣٬٦٧٣٬٨٥٦ بايت — الوزن نفسه الذي في
`target/release/`، أي إن الملف المنسوخ مطابق) و`uninstall.exe` (٧٩٬٢٥٤ بايت). ثم شُغّل الملف
المثبَّت بـ`--self-check --data-dir` فأنتج المخرجات الكاملة في القسم ٣. ودون `/D` يثبّت NSIS
للمستخدم الحالي تحت `%LOCALAPPDATA%\Programs\Warsha` ولا يحتاج صلاحيات مدير. عند النقر المزدوج
الرسومي — وبما أن الملف غير موقّع — يُتوقَّع أن يظهر تحذير Windows SmartScreen («Windows protected
your PC»): اختر `More info` ثم `Run anyway`. (لم تُشاهد تلك الشاشة في التشغيل الصامت؛ توقعها من
غياب الشهادة لا من مشاهدتها.)

### التحقق من التثبيت

```powershell
& "C:\Users\<user>\...\install\warsha-desktop.exe" --self-check --data-dir "C:\Temp\warsha-data"
```

### إلغاء التثبيت بصمت

```powershell
# داخل المجلد نفسه: يزيل ملفات التطبيق ويُبقي uninstall.exe لأنه العملية الجارية
& "...\install\uninstall.exe" /S "_?=C:\Users\...\install"
# ثم الإزالة الكاملة شاملة uninstall.exe والمجلد (يجري نفسه من نسخة مؤقتة):
Start-Process -FilePath "...\install\uninstall.exe" -ArgumentList '/S' -Wait
```

كلاهما قيس بخروج ٠: الأول حذف `warsha-desktop.exe` (وأبقى `uninstall.exe` — سلوك NSIS الموثّق مع
`_?=`)، والثاني حذف ما تبقى حتى المجلد. لا يمسّ إلغاء التثبيت `%APPDATA%\warsha`: احذفه يدويًا
لمسح المشاريع وإعداد الخادم؛ مفاتيح المزوّدين تبقى في خزنة ويندوز تحت اسم الخدمة
`warsha-provider`. من الواجهة الرسومية: «الإعدادات ← التطبيقات ← Warsha ← إلغاء التثبيت».

## ٦. Android: تثبيت APK عن طريق sideload

غلاف «Warsha Remote» (يقرن بالهاتف ولا يحمل مفاتيح نماذج) موثّق كاملًا في `apps/mobile/README.md`؛
هذا مختصر التشغيل:

```bash
# 1) خزنة التوقيع — تُنشأ مرة واحدة خارج المستودع ولا تُلتزم أبدًا
bash scripts/generate-android-keystore.sh
# → ~/.warsha/signing/warsha-release.jks وkeystore.properties

# 2) البناء (JDK 17+ وAndroid SDK platform 36 مع build-tools 36.0.0)
pnpm --filter warsha-remote build
JAVA_HOME="<JBR>" ANDROID_HOME="<SDK>" \
  apps/mobile/android/gradlew -p apps/mobile/android assembleRelease
# → apps/mobile/android/app/build/outputs/apk/release/warsha-remote-release.apk

# 3) تحقّق من التوقيع ثم ثبّت على الهاتف
"$ANDROID_HOME/build-tools/36.0.0/apksigner.bat" verify --print-certs <apk>
adb install -r <apk>
```

يقبل التطبيق روابط `warsha://pair?...` من واجهة سطح المكتب، ويخزّن رمز الاقتران في Android
Keystore‏ (AES-256-GCM) لا في نص عادي. الالتزام لأي `.jks` أو `keystore.properties` داخل git
ممنوع بـ`SECURITY.md`؛ و`assembleRelease` يفشل فورًا مع تعليمات إن لم توجد الخزنة.

## ٧. ما يفعله التطبيق عند التشغيل وأين تُحفظ البيانات

- يقرأ إعدادات الخادم من `%APPDATA%\warsha\config.toml` وينشئه عند أول تشغيل برمز من ٣٢ بايتًا
  عشوائيًا (مُرمَّز base64).
- يشغّل `warshad` داخل العملية نفسها ثم يسلّم الواجهة العنوان والرمز؛ وعند إغلاق النافذة يوقفه
  وينتظر أبناءه ويحرّر `warshad.lock`.
- البيانات كلها في `%APPDATA%\warsha`‏: `config.toml` و`warsha.db` و`desktop.json` (تفضيلات
  الواجهة) و`desktop.log` (سجل أعطال التشغيل الذي يُقرأ عند «التطبيق لا يجد الخادم»). غيّر
  المجلد بمفتاح `data_dir` داخل `config.toml`.

## ٨. حل المشكلات

| ما تراه | السبب المحتمل | ما تفعله |
|---|---|---|
| التطبيق يفتح لكن لا يجد الخادم | لم يبدأ `warshad` (المنافذ مشغولة، أو المجلد مقفول بنسخة أخرى) | اقرأ `%APPDATA%\warsha\desktop.log`؛ يجرّب التطبيق مرة واحدة على منافذ يختارها النظام |
| فشل بناء: `cl.exe not found` | السلسلة الافتراضية GNU أو بيئة MSVC غير محمّلة | `rustup default stable-x86_64-pc-windows-msvc` أو غلّف البناء عبر `vcvars64.bat` |
| فشل تغليف: تعذّر تنزيل NSIS | لا إنترنت ولا `%LOCALAPPDATA%\tauri\NSIS` مخزّن | وصّل الإنترنت لأول تغليف فقط |
| رسالة `too many arguments` عند تشغيل المُثبِّت من سطر أوامر | أمر `cmd` في المسار ليس cmd.exe الحقيقي (غلاف npm أو غطاء يظلل المسار) | نادِ `%WINDIR%\System32\cmd.exe` كاملًا أو استخدم `Start-Process` |
| تحذير SmartScreen عند النقر المزدوج | لا شهادة توقيع | `More info` ثم `Run anyway` |

## ٩. ما ليس في هذا الإصدار بعد

- **لا إصدار منشور**: لا وسم ولا صفحة تنزيل؛ كل أرقام هذا الملف من تثبيت محلي على جهاز البناء نفسه.
- **التوقيع**: لا شهادة، لذلك SmartScreen متوقع في التثبيت الرسومي.
- **التحديث الذاتي**: مطفأ الآن في `tauri.conf.json`‏ (`createUpdaterArtifacts: false` بلا
  `plugins.updater`)، فـ`tauri build` لا يطلب مفتاح توقيع؛ لا شيء يُحدَّث تلقائيًا ولا ملف
  `latest.json` منشور.
- **MSI في هذا الفوج**: لم يُبنَ (`--bundles nsis` فقط)، ولم تُختبر حزمة MSI منذ بناء ٢٠٢٦-١٠-٣١
  على الجهاز السابق.
- **منافذ ثابتة**: عند شغلهما يختار النظام غيرهما، ولا يعرفها سطر أوامر `warsha` بعد ذلك.
- **معرّف الحزمة**: القيمة `dev.warsha.app` تنتهي بـ`.app` وتنبّه أداة Tauri لتعارضها مع حزمة
  macOS؛ تغييرها يغيّر هوية المُثبِّت، فغيّرها قبل أول إصدار عام إن أردت (مثل `dev.warsha.desktop`).

القائمة القابلة للتنقل، مع ما قيس على خادم حيّ: [القيود المعروفة](src/known-limitations.md).

</div>

---

# Warsha — install and run (English)

## 1. What this file is

How to build the Windows installer (unsigned NSIS), how an owner installs it silently, verifies it
without a window, and removes it. No Rust knowledge is assumed.

**Measured status (2026-11-05, a Windows host, toolchain `stable-x86_64-pc-windows-msvc`, rustc
1.99.1):** the NSIS installer at version `0.2.0` was built on this machine, run silently from the
command line, the *installed* binary executed `--self-check` against a scratch data directory and
every check printed `PASS`, and the silent uninstall then removed the executable. The byte sizes,
SHA-256 hashes and paths in §2 and §5 are measurements of that run, not a template. Still true:
**there is no published release** — no tag, no release page; everything measured here is a local
install on the build machine itself.

Honest status: the installer is **unsigned** (no code-signing certificate), and **self-update is
now switched off in the config**: `bundle.createUpdaterArtifacts` was `true` with an active
`plugins.updater` block, which made `tauri build` demand `TAURI_SIGNING_PRIVATE_KEY` or ship an
updater pointed at an endpoint that publishes nothing; it is now `false` and the block is `{}`. A
unit test in `apps/desktop/src-tauri/src/lib.rs`
(`the_shipped_config_builds_unsigned_and_ships_no_active_updater`) keeps the file from drifting
back. No MSI was built in this run (`--bundles nsis` only).

## 2. Building the installer (developer)

### Prerequisites

| Requirement | Why | Check |
|---|---|---|
| Node.js 20+ | the frontend (Vite/TypeScript) and the Tauri CLI | `node --version` |
| pnpm 9 | the package manager this repo pins (`packageManager: pnpm@9.0.0`) | `pnpm --version` |
| Rust, the `stable-x86_64-pc-windows-msvc` toolchain | builds the Rust half | `rustup show` (it must be active/default) |
| Visual Studio Build Tools 2022 + Windows SDK | `cl.exe` and the linker MSVC needs | `vcvars64.bat` exists |
| WebView2 runtime | the app window itself (present on current Windows 10/11) | "Microsoft Edge WebView2 Runtime" in Apps |
| NSIS (`makensis.exe`) | packaging the NSIS installer | `%LOCALAPPDATA%\tauri\NSIS\makensis.exe` |

If pnpm is missing: `npm i -g pnpm@9.0.0`, or call it without installing it at all:
`npx pnpm@9.0.0 install`. The Tauri CLI downloads NSIS once into `%LOCALAPPDATA%\tauri`; on the
host that produced these measurements `makensis.exe` (NSIS v3.13) was already cached there, so
packaging needed no network. Without the cache you need a network for the first bundle.

### The commands (exactly as run on 2026-11-05)

From the repository root, in Git Bash on the Windows host (MSVC is the default toolchain there, so
no `vcvars64.bat` wrapper was needed):

```bash
pnpm install --frozen-lockfile
pnpm --filter warsha-desktop tauri build --bundles nsis
```

`tauri build` first runs `pnpm build` inside `apps/desktop` (`tsc && vite build`) to write the
frontend to `apps/desktop/dist`, then builds `apps/desktop/src-tauri` in the Rust `release`
profile, then packages it with NSIS. No `TAURI_SIGNING_PRIVATE_KEY` is read or required: with the
current `tauri.conf.json` values an unsigned build asks for no key at all.

If your machine's default toolchain is `stable-x86_64-pc-windows-gnu` and there is no
`gcc`/`mingw`, the build fails there; make MSVC the default:

```powershell
rustup default stable-x86_64-pc-windows-msvc
```

An older measured warning still applies to some hosts: do not try a `debug` build of `ring` on a
machine where it fails with `cl : Command line error D8050`; `release` is what the bundler uses
anyway, and it is the profile that works.

### Where the files land — measured sizes and hashes (2026-11-05)

| File | Path | Measured |
|---|---|---|
| The executable | `apps/desktop/src-tauri/target/release/warsha-desktop.exe` | 23,673,856 bytes; SHA-256 `087f31a6298e26539c04b9d147b2849073bee5b38f40163c1c343de14ac3a47e` |
| NSIS installer | `apps/desktop/src-tauri/target/release/bundle/nsis/Warsha_0.2.0_x64-setup.exe` | 6,487,879 bytes (6.19 MiB); SHA-256 `7e9c35d9433c86570fa399daf6bbfabe2c5984d0985a170e948e61d32c88369e` |

A build that passes `--target x86_64-pc-windows-msvc` puts both files under
`target/x86_64-pc-windows-msvc/release/...` instead; the content is the same. These sizes belong to
*this* build at `0.2.0` on this host — any code change weighs differently.

## 3. Verifying without a window: `--self-check`

On a freshly built — or installed — binary, against a scratch data directory that touches no one's
real data:

```powershell
warsha-desktop.exe --self-check --data-dir C:\Temp\warsha-check
```

This starts the `warshad` daemon in-process exactly as the window does and prints a `PASS`/`FAIL`
line per check, then stops the daemon. The `--data-dir` form is the only one that adds the two
checks that write into, start and stop more than one daemon over one directory, and it is the form
that leaves the owner alone: it moves the database, the lock and the socket into the scratch
directory and takes OS-chosen ports, so `%APPDATA%\warsha` is never opened. The full output
measured on 2026-11-05 from the **installed** binary (after the silent install in §5):

```text
data dir: C:\Users\...\warsha-nsis-test\data
daemon:     http://127.0.0.1:63605 (started by this process: true)
events ws:  ws://127.0.0.1:63606
token:      43 bytes
PASS  an authorized JSON-RPC call answers
PASS  a wrong token is refused
PASS  the webview's CORS preflight is answered
PASS  GET /health on the daemon's HTTP port answers 200 with a healthy status
PASS  projects.create creates the smoke project
PASS  runs.start starts the smoke run at the Idea stage
PASS  gates.approve records the Gate A decision over RPC
PASS  runs.advance walks Idea -> GateA -> Research -> PrdSpec on the zero-key FakeProvider
PASS  the smoke run is waiting at Gate B
PASS  zero-key FakeProvider run produced research and prd_spec artifacts
daemon stopped (children reaped, lock released)
second daemon refused, as it must: another warshad holds "...\warsha-nsis-test\data\warshad.lock" (pid ...); this daemon will not share a data directory
PASS  one daemon holds the data directory, and a restart gets it back
self-check: OK
```

What the zero-key FakeProvider round trip means: a complete pipeline cycle over JSON-RPC with no
API key anywhere. A project `smoke-project` is created, a run on an Arabic product idea starts at
`Idea`, Gate A is decided through `gates.approve` (with `device_id: null` — the recorded approver
is the device the transport authenticated, never one the params claim), `runs.advance` then walks
`Idea -> GateA -> Research -> PrdSpec` and stops waiting at the pending Gate B, and
`runs.artifacts` confirms `idea`, `research` and `prd_spec` were generated and persisted — they
were found on disk in `data\projects\<uuid>\factory\research.md` and `prd_spec.md`. The model-call
stages are answered by the deterministic, zero-network `FakeProvider` (warsha-pipeline dispatch
case 3: no routed provider and no environment key), and the check sets `WARSHA_LLM_PROVIDER=fake`
itself, so even a machine carrying a `WARSHA_LLM_API_KEY` in its environment cannot turn the smoke
run into a real paid model call.

**Do not carry this over to the standalone daemon.** `--data-dir` is an option of
`warsha-desktop --self-check` and nothing else; `warshad` does not know it — its flags are
`--config`, `--foreground`, `--http-port`, `--ws-port` and `--socket`, and an unknown flag is a
refusal. The daemon's data directory is the `data_dir` key inside `config.toml`, never a
command-line switch.

## 4. First launch: zero keys, `WARSHA_LLM_API_KEY`, or a registered provider

- **Nothing configured (the path §3's smoke test takes):** nothing is refused. Unrouted pipeline
  roles are answered by the deterministic zero-network `FakeProvider`, so an owner with no key can
  still watch a full idea-to-gates cycle.
- **An environment key:** with `WARSHA_LLM_API_KEY` (optionally `WARSHA_LLM_BASE_URL` and
  `WARSHA_LLM_MODEL`) set in the environment of the process that launches the app or `warshad`,
  unrouted roles are answered by that OpenAI-compatible endpoint; set `WARSHA_LLM_PROVIDER=fake`
  to force the deterministic provider anyway. This key comes from the environment, not the OS
  keychain, and is never written to a file.
- **A provider registered in the onboarding wizard:** its key goes to the Windows Credential
  Manager, never appears in a reply, and a role routed to it takes precedence over both paths
  above. The step-by-step walkthrough is [First run: adding your provider key](src/first-run.md).

## 5. Silent install, verify, uninstall (run exactly like this on 2026-11-05)

### Silent install

The NSIS installer is standard: `/S` is silent, and `/D=<path>` — always the last parameter,
without quotes around it — chooses the directory. The two forms that worked on the machine:

```powershell
# PowerShell (the preferred form — this is what was actually measured)
Start-Process -FilePath "...\bundle\nsis\Warsha_0.2.0_x64-setup.exe" `
  -ArgumentList '/S', '/D=C:\Users\...\warsha-nsis-test\install' -Wait -PassThru
```

```text
cmd.exe /c "...\Warsha_0.2.0_x64-setup.exe /S /D=C:\Users\...\install"
```

(Measured warning from this host: if the `cmd` resolved on your `PATH` is not the real `cmd.exe` —
here an npm shim simply named `cmd` shadowed it — you get a nonsense
`error: too many arguments. Expected 1 argument but got 2.` that has nothing to do with the
installer. Call `%WINDIR%\System32\cmd.exe` by full path, or use the first form.)

Measured outcome (exit code 0): the directory contains `warsha-desktop.exe` (23,673,856 bytes —
the same size as `target/release/`, i.e. the copied file matches the built one) and
`uninstall.exe` (79,254 bytes). The installed binary then printed the complete §3 transcript
above via `--self-check --data-dir`. Without `/D`, NSIS installs per-user under
`%LOCALAPPDATA%\Programs\Warsha` and needs no administrator. On a double-click install — the file
being unsigned — Windows SmartScreen is expected to show "Windows protected your PC": choose
`More info`, then `Run anyway`. (That screen was *not* observed in the silent runs; it is expected
from the absence of a certificate, not from a sighting.)

### Verify the install

```powershell
& "C:\Users\<user>\...\install\warsha-desktop.exe" --self-check --data-dir "C:\Temp\warsha-data"
```

### Silent uninstall

```powershell
# in-place: removes the app files, keeps uninstall.exe (it is the running process)
& "...\install\uninstall.exe" /S "_?=C:\Users\...\install"
# full removal, including uninstall.exe and the directory (it re-runs itself from a temp copy):
Start-Process -FilePath "...\install\uninstall.exe" -ArgumentList '/S' -Wait
```

Both were measured with exit code 0: the first removed `warsha-desktop.exe` (and left
`uninstall.exe` — NSIS's documented `_?=` behavior), the second removed what remained including
the directory. Uninstalling never touches `%APPDATA%\warsha`: delete it by hand to remove the
projects and the daemon configuration; provider keys stay in the Windows Credential Manager under
the service name `warsha-provider`. Through the UI: Settings → Apps → Warsha → Uninstall.

## 6. Android: sideloading the APK

The "Warsha Remote" shell (it pairs with the phone and holds no model keys) is fully documented in
`apps/mobile/README.md`; the operational summary:

```bash
# 1) the signing keystore — created once, OUTSIDE the repository, never committed
bash scripts/generate-android-keystore.sh
# → ~/.warsha/signing/warsha-release.jks and keystore.properties

# 2) build (JDK 17+, Android SDK platform 36 + build-tools 36.0.0)
pnpm --filter warsha-remote build
JAVA_HOME="<JBR>" ANDROID_HOME="<SDK>" \
  apps/mobile/android/gradlew -p apps/mobile/android assembleRelease
# → apps/mobile/android/app/build/outputs/apk/release/warsha-remote-release.apk

# 3) verify the signature, then install onto the phone
"$ANDROID_HOME/build-tools/36.0.0/apksigner.bat" verify --print-certs <apk>
adb install -r <apk>
```

The app accepts `warsha://pair?...` deep links from the desktop UI and stores the pairing token in
the Android Keystore (AES-256-GCM), never in plaintext. Committing any `.jks` or
`keystore.properties` into git is forbidden by `SECURITY.md`; `assembleRelease` fails fast with
instructions when the keystore is missing.

## 7. What the app does when it starts, and where the data lives

- Reads the daemon configuration from `%APPDATA%\warsha\config.toml`, creating it on first run
  with 32 fresh random bytes as its token (base64-encoded).
- Starts `warshad` *inside its own process*, hands the webview the address and token, and on
  window close stops the daemon, waits for its children and releases `warshad.lock`.
- All state lives in `%APPDATA%\warsha`: `config.toml`, `warsha.db`, `desktop.json` (UI
  preferences) and `desktop.log` (the startup log to read when "the app opens but finds no
  daemon"). Change the directory with the `data_dir` key in `config.toml`.

## 8. Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| The app opens but finds no daemon | `warshad` did not start (ports taken, or the data directory is held by another instance) | read `%APPDATA%\warsha\desktop.log`; the shell retries once on OS-chosen ports |
| Build fails with `cl.exe not found` | the default Rust toolchain is GNU, or MSVC is not loaded | `rustup default stable-x86_64-pc-windows-msvc`, or wrap the build in `vcvars64.bat` |
| Bundling fails: NSIS could not be downloaded | no network and no `%LOCALAPPDATA%\tauri\NSIS` cache | connect a network for the first bundle only |
| `too many arguments` when starting the installer from a shell | `cmd` on the `PATH` is not the real `cmd.exe` (an npm shim or wrapper shadowing it) | call `%WINDIR%\System32\cmd.exe` by full path, or use `Start-Process` |
| SmartScreen warning on double-click | no code-signing certificate | `More info` → `Run anyway` |

## 9. Not in this build yet

- **No published release**: no tag, no release page; every number here is a local install on the
  build machine itself.
- **Signing**: no certificate, so SmartScreen is expected on a GUI install.
- **Self-update**: now switched off in `tauri.conf.json` (`createUpdaterArtifacts: false`, no
  `plugins.updater`), so `tauri build` asks for no signing key; nothing updates itself and no
  signed `latest.json` is published.
- **MSI in this batch**: not built (`--bundles nsis` only); the MSI path is untested since the
  2026-10-31 build on the previous host.
- **Fixed ports**: when 8765/8766 are taken the OS picks others, and the `warsha` CLI does not
  know about them afterwards.
- **Bundle identifier**: `dev.warsha.app` ends in `.app`, which Tauri warns clashes with the macOS
  bundle extension; changing it changes the installer's identity, so change it before the first
  public release if you want to (e.g. `dev.warsha.desktop`).

The navigable list of limitations, including what was measured against a running daemon, is
[Known limitations](src/known-limitations.md).
