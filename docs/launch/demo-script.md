# Demo Video Script

A three-minute screen recording for the launch page, the store listings, and the launch posts. Same
take supplies the screenshots, so record once and cut everything from it.

The video is a **Gate D asset**: it is recorded by the owner or by an agent-assisted session the
owner controls, and it is not published anywhere until the owner approves it.

## Recording Setup

| Item | Setting |
|------|---------|
| Machine | Clean profile or fresh VM — no personal files, no existing projects |
| Resolution | 1920×1080, 30 fps, windowed at 1440×900 so text stays readable |
| Locale | Start in Arabic (`ar`), switch to English mid-video to show the toggle |
| Provider | Local Ollama (`warsha providers add ollama --name local-llama --base-url http://localhost:11434`), or a throwaway key that is never on screen |
| Terminal | 16 pt monospace, dark theme, no transparency, prompt without a home path |
| Notifications | Off. Do not disturb on. Close mail, chat, and browser tabs |
| Cursor | Slow and deliberate; no fast scrolling, no drag-select of text |

`warsha doctor` before recording: fix anything it reports as missing so the take does not stall.

## Shot List

| Time | Shot | On screen | Narration (English / Arabic) |
|------|------|-----------|------------------------------|
| 0:00–0:15 | Cold open | Desktop app, Simple mode, twelve agent roles in the sidebar | "This is Warsha — an Arabic-first AI software factory. Twelve agents, four gates, one repository." / «هذه ورشة — مصنع برمجيات بالذكاء الاصطناعي.» |
| 0:15–0:35 | Install check | Terminal: `warsha doctor` and its toolchain table | "One command tells you what this machine can already do." / «أمر واحد يخبرك بما تستطيع هذا الجهاز فعله.» |
| 0:35–0:55 | New project | `warsha new "متجر إلكتروني صغير بواجهة عربية وإنجليزية"` then `warsha status` | "One line of idea starts the pipeline at the Idea stage." / «فكرة في سطر واحد تبدأ المسار.» |
| 0:55–1:20 | Pipeline runs | `warsha logs --follow` scrolled slowly; stage transitions visible | "Research, requirements, design — each stage writes an artifact you can read." / «كل مرحلة تكتب وثيقة يمكنك قراءتها.» |
| 1:20–1:45 | Gate A waits | `warsha gates`, then the desktop Gates inbox with the pending card | "The run stops at Gate A. Nothing moves until you approve it." / «المسار يتوقف عند البوابة A حتى توافق.» |
| 1:45–2:10 | Approve | Desktop: approve with device confirmation; the card clears and the run advances | "Approve from the desktop or from a paired phone — never from an agent." / «الموافقة من الحاسب أو الهاتف، ولا يمكن لأي وكيل أن يوافق.» |
| 2:10–2:30 | Artifacts | File tree: `factory/` artifacts, one opened in the viewer | "Every stage leaves a file, in the language you chose." / «كل مرحلة تترك ملفاً، باللغة التي اخترت.» |
| 2:30–2:45 | Cost | Advanced mode costs panel, budget set then spent | "Budgets are per project and per role, and a run pauses instead of overspending." / «الميزانية لكل مشروع ولكل دور.» |
| 2:45–3:00 | Close | Landing page, quickstart link, license line | "Warsha: idea in, gated delivery out. Non-commercial, local-first, your own provider." / «ورشة: من الفكرة إلى التسليم المُبوَّب.» |

## Do Not Show

- API keys, tokens, `.env` content, or the provider settings screen with a key field filled.
- Home directory paths, usernames, emails, notification popups, or browser bookmarks.
- Any real customer project, private repository name, or third-party code.
- An invented metric. If a number appears, it must be a real one the owner can link.

## Screenshots To Pull From The Same Take

| Asset | Frame | Used in |
|-------|-------|---------|
| Simple mode with the agent sidebar | 0:05 | Landing page, Microsoft Store |
| Gates inbox with a pending card | 1:30 | Landing page, store listing |
| Pipeline advancing after approval | 2:05 | Landing page |
| `factory/` artifacts | 2:15 | Landing page, docs quickstart |
| Advanced mode costs panel | 2:35 | Landing page |

Store art needs its own crops; see the package type requirements in
[microsoft-store.md](../store/microsoft-store.md).

## Post-Production

- Burned-in captions in Arabic and English; no auto-generated captions left unedited.
- Chapters: Doctor · New project · Pipeline · Gate A · Approve · Artifacts · Budgets.
- Audio: narration only, or captions plus music that the owner has the right to use.
- Deliverables: `warsha-demo-ar.mp4`, `warsha-demo-en.mp4`, and a poster frame per locale.
- Upload unlisted until Gate D approval; publish by hand afterwards.
- Add the final link to the launch post drafts in `docs/social/calendar.md` (the `{{video_url}}`
  placeholder) and to `docs/launch/checklist.md`.
