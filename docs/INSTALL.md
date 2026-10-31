# تثبيت ورشة وتشغيلها — Warsha install and run

<div dir="rtl">

## ١. ما هذا الملف

هذا الملف يشرح أمرين فقط: كيف تبني مُثبِّت ورشة على ويندوز، وكيف يثبّته المالك ويشغّله.
لا يفترض أي معرفة بلغة Rust. الأوامر مكتوبة كما شُغّلت فعلًا على جهاز ويندوز واحد، ومعها
ما ظهر من مخرجات.

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

إن لم يكن `pnpm` مثبتًا: `npm i -g pnpm@9.0.0`.

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

### أين تظهر الملفات

| الملف | المسار | الحجم |
|---|---|---|
| التطبيق التنفيذي | `apps/desktop/src-tauri/target/x86_64-pc-windows-msvc/release/warsha-desktop.exe` | ٢٠٫٠ م.ب تقريبًا |
| مُثبِّت MSI | `apps/desktop/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi/Warsha_0.1.0_x64_en-US.msi` | ٨٬٠٨٥٬٥٠٤ بايت (٧٫٧١ م.ب) |
| مُثبِّت NSIS | `apps/desktop/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/Warsha_0.1.0_x64-setup.exe` | ٥٬٧٢٦٬٨٣٤ بايت (٥٫٤٦ م.ب) |

أول تغليف يحتاج إنترنت: تنزّل أداة Tauri ملفات WiX (‏`wix314-binaries.zip`) و NSIS
(‏`nsis-3.13.zip` و `nsis_tauri_utils.dll`) مرة واحدة إلى `%LOCALAPPDATA%\tauri`. بدون إنترنت
يفشل التغليف وحده، ويبقى الملف التنفيذي في مكانه صالحًا للتشغيل المباشر.

### التحقق من التطبيق دون فتح نافذة

```powershell
warsha-desktop.exe --self-check
warsha-desktop.exe --self-check --data-dir C:\Temp\warsha-check
```

يبدأ هذا الأمر الخادم `warshad` كما تفعل النافذة تمامًا، ثم يتحقق ويطبع: أن استدعاء JSON-RPC
برمز صحيح يُجاب، وأن رمزًا خاطئًا يُرفض، وأن طلب CORS التمهيدي من أصل النافذة
(`http://tauri.localhost`) يُجاب — ثم يوقف الخادم ويذكر أن القفل حُرِّر. النسخة التي تحمل
`--data-dir` لا تلمس بيانات المالك، وهي المناسبة لفحص التثبيت على جهاز آخر.


## ٣. التثبيت (للمالك)

1. شغّل أحد الملفين: `Warsha_0.1.0_x64-setup.exe` (مُثبِّت NSIS) أو `Warsha_0.1.0_x64_en-US.msi`.
   كلاهما يُثبِّت للمستخدم الحالي دون صلاحيات مدير.
2. لأن الملفات غير موقّعة، سيظهر تحذير Windows SmartScreen («Windows protected your PC»).
   اختر `More info` ثم `Run anyway`. هذا هو الأثر الوحيد لغياب شهادة التوقيع.
3. شغّل «Warsha» من قائمة ابدأ.
4. أول تشغيل يعرض شاشة الإعداد: اختر اللغة، أضف مزوّد ذكاء اصطناعي ومفتاحه، ثم أنشئ مشروعك
   الأول. المفتاح يُحفظ في خزنة ويندوز (Windows Credential Manager) ولا يُكتب في أي ملف نصي.

### ما يفعله التطبيق عند التشغيل

- يقرأ إعدادات الخادم من `%APPDATA%\warsha\config.toml`، وينشئه مع رمز (token) عشوائي من
  ٣٢ بايت عند أول تشغيل.
- يشغّل الخادم `warshad` داخل العملية نفسها، ثم يسلّم الواجهة عنوانه ورمزه.
- عند إغلاق النافذة يُوقف الخادم وينتظر أبناءه، ويحرّر ملف القفل `warshad.lock`.

### أين تُحفظ البيانات

| المحتوى | المسار |
|---|---|
| إعدادات الخادم ورمزه | `%APPDATA%\warsha\config.toml` |
| قاعدة البيانات والمشاريع | `%APPDATA%\warsha\warsha.db` |
| تفضيلات الواجهة (`onboarding_complete`, `app_mode`) | `%APPDATA%\warsha\desktop.json` |
| سجل أخطاء تشغيل التطبيق | `%APPDATA%\warsha\desktop.log` |
| التطبيق نفسه | `%LOCALAPPDATA%\Warsha` (حسب إعداد أداة التغليف) |

### إلغاء التثبيت

من «الإعدادات ← التطبيقات ← التطبيقات المثبتة» اختر Warsha ثم «إلغاء التثبيت». أو بالـ MSI:

```powershell
msiexec /x "Warsha_0.1.0_x64_en-US.msi"
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

- **التوقيع**: لا شهادة، لذلك تحذير SmartScreen في كل تثبيت.
- **التحديث الذاتي**: `plugins.updater` مضبوط، لكن حزمة `tauri-plugin-updater` ليست تبعية بعد
  ولا يوجد `latest.json` موقّع، فلا شيء يُحدَّث تلقائيًا.
- **بث الأحداث في الواجهة**: نقطة `/events` تتطلب رأس `Authorization`، ومتصفح النافذة لا
  يستطيع إرساله عند فتح مقبس WebSocket، فالتطبيق يعمل لكل استدعاءات JSON-RPC دون البث الحيّ.
- **منافذ ثابتة**: إن كان 8765/8766 مشغولًا يختار النظام منافذ أخرى، ولا يعرفها سطر أوامر
  `warsha` بعد ذلك.
- **معرّف الحزمة**: القيمة الحالية `dev.warsha.app` تنتهي بـ `.app`، وتنبّه أداة Tauri إلى
  تعارضها مع امتداد حزمة macOS؛ تغييرها لاحقًا يغيّر هوية المُثبِّت، فالأفضل تغييرها قبل أول
  إصدار عام (`dev.warsha.desktop` مثلًا).

</div>

---

# Warsha — install and run (English)

## 1. What this file is

Two things: how to build the Windows installer, and how an owner installs and runs the result.
No Rust knowledge is assumed. The commands are the ones actually run on one Windows host, with
what they printed.

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

If pnpm is missing: `npm i -g pnpm@9.0.0`.

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

### Where the files land

| File | Path | Size |
|---|---|---|
| The executable | `apps/desktop/src-tauri/target/x86_64-pc-windows-msvc/release/warsha-desktop.exe` | ~20.0 MB |
| MSI installer | `apps/desktop/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi/Warsha_0.1.0_x64_en-US.msi` | 8,085,504 bytes (7.71 MiB) |
| NSIS installer | `apps/desktop/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/Warsha_0.1.0_x64-setup.exe` | 5,726,834 bytes (5.46 MiB) |

The first bundle needs a network: the Tauri CLI downloads WiX (`wix314-binaries.zip`) and NSIS
(`nsis-3.13.zip` and `nsis_tauri_utils.dll`) once into `%LOCALAPPDATA%\tauri`. Without a network,
only the bundling step fails; the executable is still there and can be run directly.

### Verifying an install without a window

```powershell
warsha-desktop.exe --self-check
warsha-desktop.exe --self-check --data-dir C:\Temp\warsha-check
```

That starts the `warshad` daemon exactly as the window does and then asserts, printing each step:
an authorized JSON-RPC call is answered, a wrong token is refused, and the CORS preflight from the
webview's own origin (`http://tauri.localhost`) is answered — then it stops the daemon and reports
that the lock was released. The `--data-dir` form leaves the owner's data alone, which is what a
check on someone else's machine wants.


## 3. Installing (owner)

1. Run either `Warsha_0.1.0_x64-setup.exe` (NSIS) or `Warsha_0.1.0_x64_en-US.msi`. Both install
   for the current user and need no administrator rights.
2. Because the files are unsigned, Windows SmartScreen shows "Windows protected your PC". Choose
   `More info`, then `Run anyway`. That warning is the only consequence of the missing certificate.
3. Start **Warsha** from the Start menu.
4. The first run shows the setup screen: pick the language, add an AI provider and its key, then
   create the first project. The key is stored in the Windows Credential Manager, never in a file.

### What the app does when it starts

- Reads the daemon configuration from `%APPDATA%\warsha\config.toml`, creating it with a fresh
  32-byte random token on the very first run.
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
| The app itself | `%LOCALAPPDATA%\Warsha` (as the bundler lays it out) |

### Uninstalling

Settings → Apps → Installed apps → Warsha → Uninstall, or through the MSI:

```powershell
msiexec /x "Warsha_0.1.0_x64_en-US.msi"
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

- **Signing**: no certificate, so SmartScreen warns on every install.
- **Self-update**: `plugins.updater` is configured, but `tauri-plugin-updater` is not a dependency
  and no signed `latest.json` is published, so nothing updates itself.
- **Event stream in the webview**: `/events` requires an `Authorization` header, which a browser
  cannot send when opening a WebSocket, so the app does every JSON-RPC call live but not the live
  event feed.
- **Fixed ports**: when 8765/8766 are taken the OS picks others, and the `warsha` CLI does not know
  about them afterwards.
- **Bundle identifier**: the current value `dev.warsha.app` ends in `.app`, which Tauri warns clashes
  with the macOS bundle extension. Changing it later changes the installer's identity, so it is
  cheapest to change it before the first public release (e.g. `dev.warsha.desktop`).
