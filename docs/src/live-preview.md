# Live Preview Panel

<div dir="rtl" lang="ar">

## لوحة المعاينة المباشرة

لوحة صغيرة داخل شاشة التشغيل تعرض التطبيق الذي يعمل الآن، وتحوّل نقرة واحدة
إلى سياق يصل إلى المساعد:

- **الإطار (iframe)** — يعرض عنوان خادم التطوير الحالي. لا يوجد عنوان بعد؟
  تظهر لوحة بديلة تقول «لا توجد معاينة بعد» مع خطوة تالية واضحة.
- **شريط الأدوات** — تشغيل، إيقاف، فتح في نافذة، والتقاط عنصر. كل زر له أيقونة
  ونص، وحالة تعطيل واحدة مشتركة تتبع حالة المعاينة.
- **فتح في نافذة** — يفتح العنوان في نافذة منفصلة عبر `window.open`. لا يوجد
  عنوان؟ الزر معطّل ولا يُفتح شيء.
- **التقاط عنصر** — هنا الصدق التقني: صفحة داخل إطار من أصل مختلف لا يمكن قراءتها
  من التطبيق، لذلك لا يمكن التقاط النقرة داخلها مباشرة. عند تفعيل الالتقاط يظهر
  شريط فوق المعاينة يقول «انقر على عنصر في المعاينة» مع حقل نصي تلصق فيه المحدد،
  وعند الإرسال يُستدعى `onElementClick(selector)` فتصبح الإشارة `@element(#submit)`
  في مربع المحادثة.

### لماذا اللصق خطوة مؤقتة

الجسر الحقيقي يحتاج تعاون التطبيق المعروض نفسه: يرسل رسالة `postMessage` عند كل
نقرة. الشكل المقترح موثّق أدناه في القسم الإنجليزي. حتى يصل ذلك الجسر، الحقل
النصي هو الطريق الصادق الوحيد — لا ندّعي التقاطًا لا نملكه.

### اتجاه الواجهة

اللوحة تستخدم `dir` وخصائص CSS المنطقية (`paddingInline`، `insetInline`,
`borderBlockEnd`). حقل المحدد يبقى `dir="ltr"` لأن محددات CSS تُكتب من اليسار
إلى اليمين في اللغتين.

</div>

## English

Live preview is two desktop components: `apps/desktop/src/components/LivePreview.tsx` (the
panel) and `apps/desktop/src/components/PreviewToolbar.tsx` (its four actions). LingCode-inspired
ideas only: no code, text or asset was copied from it. No dependency was added.

### Panel

```ts
type PreviewStatus = 'idle' | 'running' | 'stopped' | 'error';

function LivePreview(props: {
  url: string | null;
  onElementClick?: (selector: string) => void;
  onRun: () => void;
  onStop: () => void;
  status: PreviewStatus;
}): JSX.Element;

function PreviewToolbar(props: {
  status: PreviewStatus;
  onRun: () => void;
  onStop: () => void;
  onPopOut: () => void;
  onPickElement: () => void;
  picking: boolean;
}): JSX.Element;
```

`LivePreview` renders a `<iframe src={url}>` when `url` is set and a placeholder
(`No preview yet` / `Start the dev server, then press Run`) when it is `null`. The panel
mounts the toolbar itself and owns only the pick toggle's local state: the dev server
process, the URL and the status stay with the caller, so the same panel serves the run view
and any future preview surface. `status === 'error'` adds a `role="alert"` line telling the
owner to check the dev server log and press Run again.

### Toolbar actions

| Action         | Icon | Disabled when             | What it does                        |
| -------------- | ---- | ------------------------- | ----------------------------------- |
| Run            | `▶`  | `running`                 | calls `onRun` (start the dev server) |
| Stop           | `■`  | any status but `running`  | calls `onStop`                      |
| Pop out        | `↗`  | `idle` or `error`         | `window.open(url, '_blank', 'noopener,noreferrer')` |
| Pick element   | `⌖`  | any status but `running`  | toggles the pick overlay (`aria-pressed`) |

The rules are one exported function, so the caller and the tests read the same table instead
of re-deriving it:

```ts
previewToolbarDisabled(status): {
  run: boolean;
  stop: boolean;
  pop_out: boolean;
  pick_element: boolean;
};
```

`noopener,noreferrer` matters twice: the previewed page never gets `window.opener` back into
the desktop app, and the preview URL is not leaked to the pop-out's referrer. With `url` set
to `null` the handler returns early — no window opens even if the click lands.

### Click-to-point

A cross-origin iframe is opaque: the parent cannot read its DOM, cannot receive its clicks,
and the `sandbox` attribute removes the same-origin escape hatch. So the panel does not
pretend to capture clicks. Pressing **Pick element** while the preview is running opens an
overlay bar above the frame:

- the hint `Click an element in the preview`;
- a note that the preview runs on another origin, so the selector is pasted;
- a text input (always `dir="ltr"`, because CSS selectors read left-to-right in both
  languages) and a submit button.

Submitting trims the selector, ignores an empty value, calls `onElementClick(selector)` and
clears the field. The overlay stays open — pointing at three elements in a row is the common
case, and the owner is the one who turns it off. When the status leaves `running` the overlay
disappears on its own: a stopped preview has no document to point at.

`onElementClick` is optional, so a read-only mount (for example a preview screen inside a gate
review) cannot crash on a submit.

The composer side is one pure helper, exported so the panel and the composer agree on one
shape:

```ts
elementMention('#submit'); // '@element(#submit)'
```

`App.tsx` is what appends `elementMention(selector)` to the composer once the run view passes
its own `onElementClick`.

#### The bridge that removes the paste step

The previewed app can report its own clicks. The suggested wire format, kept as a documented
contract because the panel does not implement a listener yet:

```js
// inside the previewed app
document.addEventListener('click', (event) => {
  const selector = cssPath(event.target); // app-provided helper
  window.parent.postMessage({ type: 'warsha:preview-pick', selector }, '*');
});
```

The parent's listener must (1) accept only `type === 'warsha:preview-pick'`, (2) check
`event.source` is the previewed frame, and (3) treat `selector` as untrusted data — it is
appended to the composer as a mention, never executed and never interpreted as an
instruction. That third rule is the same one the agent guardrails apply to any page content.

### Security

The frame is sandboxed (`allow-scripts allow-same-origin allow-forms allow-popups
allow-modals`) and sends no referrer (`referrerPolicy="no-referrer"`). Agent-generated code is
what runs inside it, so the panel must not give it top navigation, a route into the desktop
app's DOM, or a way to read desktop cookies. No credential, keychain entry or provider header
is read here, and nothing is logged: the dev server URL is the only input.

### RTL

The panel and the toolbar both take `dir` from `useDirection()` and use logical CSS properties
(`paddingInline`, `insetInline`, `borderBlockEnd`) instead of `left`/`right`. Only the selector
input is pinned to `dir="ltr"`. Every string goes through `t()` with an ar/en fallback, so a
catalog entry added later takes precedence automatically.

### What is not here yet

- **Nothing is mounted in a screen.** The allowed file scope is the two components, their
  tests and this chapter, so `RunView` does not render the panel yet (same precedent as the
  work-protection and router components).
- **No process manager.** `onRun` / `onStop` are seams; nothing spawns, supervises or kills the
  dev server, and `warshad` has no preview RPC.
- **No `postMessage` listener.** The bridge above is a documented contract, not implemented
  code: real picking still means pasting a selector.
- **No Android preview.** `PLAN.md` M5b also asks for an emulator or device QR with the same
  controls; that is not in this batch's allowed files, and the panel says nothing about it.
- **No live status feed.** The caller supplies `status`; nothing derives it from build output,
  the event stream or a port probe.
