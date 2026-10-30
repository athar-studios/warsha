# Demo Video — landing-page cut (3:00)

The video that sits under the landing-page hero, and the only video the store listings and launch
posts may quote. It is a **Gate D asset**: recorded by the owner or by an owner-controlled session,
unlisted until the owner approves it, published by hand afterwards.

This page is the cut sheet for that video. The recording environment, the do-not-show list, the
screenshot pulls and the post-production rules live in the parent document,
[the demo video script](demo-script.md); everything below is the 3:00 landing-page edit derived
from it, plus the numeric-claims check that has to pass before the video is approved.

## Non-negotiables

| Item | Rule |
|------|------|
| Provider | The **mock provider** for the whole take — `warshad` registers a provider named `mock` (`MockProvider` in `crates/warshad/src/lib.rs`), so the run needs no key and no network — or a local Ollama that needs no account. No real API key is typed, shown, or pasted, not even blurred |
| Language | Arabic first with burned-in Arabic captions; the English cut is captioned separately from the same frames |
| Machine | Clean profile or fresh VM, no personal files, no existing projects, notifications off |
| Numbers | Every number on screen is one the owner can point at (see [Numeric claims](#numeric-claims-check-before-gate-d)); if a figure has no measurement behind it, it does not appear |
| Claims | No testimonials, no user counts, no "trusted by", no benchmark table. There are no users yet and the video says nothing that implies otherwise |
| Cost shown | The cost panel shows the mock provider's real recorded spend for that run — zero or the mock tariff, never a made-up dollar figure |

## Shot List (3:00)

Five beats, in this order: **install → add provider → new project → approve gates → final repo**.
Timecodes are targets, not limits; the cut has to land at 3:00 with all five beats present.

### 0:00–0:20 — Install

| Field | Value |
|-------|-------|
| On screen | Terminal, dark theme, 16 pt mono, prompt without a home path |
| Commands | `warsha --version`, `warsha init`, `warsha doctor` |
| Shot | The `doctor` table: toolchain and AI CLIs, each with its checkmark or the reason it is missing |
| Caption (ar) | «تثبيت واحد، ثم أمر واحد يخبرك بما يستطيع هذا الجهاز فعله.» |
| Caption (en) | "One install, then one command that tells you what this machine can already do." |
| Do not | Scroll the doctor table fast; no `~` paths, no hostname, no shell history visible |

### 0:20–0:45 — Add provider

| Field | Value |
|-------|-------|
| On screen | Terminal, then the desktop Providers settings |
| Commands | `warsha providers add ollama --name local-llama --base-url http://localhost:11434`, `warsha providers list`, `warsha providers test local-llama` |
| Shot | The provider row going from "not tested" to "ok"; the key field left empty on screen for the local provider |
| Caption (ar) | «أحضر مزوّدك: مفتاحك أو نموذج محلي على جهازك، ولا شيء يمرّ عبر ورشة.» |
| Caption (en) | "Bring your own provider — your key or a local model on your own machine." |
| Do not | Open a settings screen with a real key filled in, or show a keychain entry |

### 0:45–1:15 — New project

| Field | Value |
|-------|-------|
| On screen | Terminal, then the desktop projects board |
| Commands | `warsha new "متجر إلكتروني صغير بواجهة عربية وإنجليزية"`, `warsha status`, `warsha logs --follow` |
| Shot | One line of idea becomes a run at the **Idea** stage; the board shows the project card in the first column; the log shows stage transitions, scrolled slowly |
| Caption (ar) | «فكرة في سطر واحد تبدأ المسار: 14 مرحلة، أربع بوابات، لا خطوة مخفيّة.» |
| Caption (en) | "One line of idea starts the pipeline — 14 stages, four gates, no hidden step." |
| Do not | Show a run that is already finished; nothing on screen may suggest the run needs no approval |

### 1:15–2:25 — Approve the gates

| Field | Value |
|-------|-------|
| On screen | Desktop Gates inbox, then the CLI |
| Commands | `warsha gates`, `warsha approve gate_a`, `warsha approve gate_b`, `warsha approve gate_c` |
| Shot, part 1 (1:15–1:40) | **Gate A** pending with the brief artifact open beside it; approve from the desktop with the device confirmation, then the run advances to Research |
| Shot, part 2 (1:40–2:05) | **Gate B**: the spec artifact and its scope, approved the same way; the run moves to Design → Plan Tasks → Code |
| Shot, part 3 (2:05–2:25) | **Gate C**: the review/QA/security result, the diff summary, then approve and watch the merge step start. A **rejected** gate is shown once, briefly, with the run returning to the spec stage — the gate is a decision, not a formality |
| Caption (ar) | «كل بوابة تنتظرك أنت: الوكلاء يقترحون وينفّذون، والمالك يعتمد. لا وكيل يعتمد بوابة.» |
| Caption (en) | "Every gate waits for you. Agents propose and execute; the owner approves — no agent ever can." |
| Do not | Skip Gate D on screen without saying why: it comes at 2:55 in the close card, still pending |
| Why this is the longest beat | The gates are the product. A landing video that spends its time on a chat box and none on the approvals shows the wrong thing |

### 2:25–2:55 — Final repository

| Field | Value |
|-------|-------|
| On screen | GitHub (or the local repository view), then the `factory/` file tree |
| Shot | The repo created from the template, one branch and pull request per task, the check status green, the merged pull requests, the **draft** release, and the `factory/` artifacts that produced all of it |
| Caption (ar) | «مستودع يعمل في النهاية: فروع وطلبات دمج مدمجة، فحوصات خضراء، وإصدار مسودّة ينتظر البوابة D.» |
| Caption (en) | "A working repository at the end: merged pull requests, green checks, and a draft release waiting at Gate D." |
| Do not | Show a real third-party repository, a real customer name, a stargazer count, or any number the owner cannot link |

### 2:55–3:00 — Close

| Field | Value |
|-------|-------|
| On screen | Landing page, hero, quickstart link, licence line |
| Caption (ar) | «ورشة: من الفكرة إلى التسليم المُبوَّب — محلي أولاً، بمزوّدك، وبموافقتك.» |
| Caption (en) | "Warsha: idea in, gated delivery out — local-first, your own provider, your approval." |
| Do not | Cut a "download now" button that 404s, or a store badge for a listing that is not submitted (`docs/store/*` all say `not yet submitted`) |

## How the landing page uses it

`docs/src/index.md` carries the hero placeholder, a poster frame and a link to this page. The embed
is an HTML comment in that file until the file exists, so no page ever renders a dead player; the
owner uncomments the two lines and drops in the URL after Gate D approval. Store listings quote the
same cut, not a second recording.

## Numeric claims check (before Gate D)

This is the checklist item the milestone's acceptance criteria ask for: **no unverified numeric
claim in `docs/`**. Run it before approving the video, the landing page, or any launch post.

1. List every number on the public pages:

   ```bash
   grep -RnoE '\b[0-9]+([.,][0-9]+)?\s?(%|x|k|ms|s|MB|GB)?\b' \
     docs/src/index.md docs/src/changelog.md docs/src/quickstart.md \
     docs/src/gates.md docs/store docs/social docs/launch
   ```

2. For each hit, either it is a literal the reader is meant to type (`0.1.0`, `0600`, `11434`,
   `--version` flags, ISO dates, stage counts), or it is a claim that must appear in the table below
   with a measurement it traces to.

   | Claim | Where it appears | Traces to |
   |-------|------------------|-----------|
   | 12 agents | landing hero, agent table | the twelve prompt files in `crates/warsha-pipeline/src/prompts/` |
   | 14 stages | landing hero, pipeline diagram | `Stage::all()` in `crates/warsha-core/src/lib.rs` (14 entries) |
   | 4 gates | landing hero, gate table | `Stage::is_gate()` — GateA/GateB/GateC/GateD |
   | 3 operating systems | quickstart, release notes | the `os:` matrix in `.github/workflows/release.yml` and in the CI workflow |
   | 6 preflight checks | landing page, status strip chapter | `ReleasePreflight`'s fixed check list |

3. Anything not in that table is either removed or replaced with a measurement the owner can link.
   An invented user count, download count, star count, testimonial, star rating, or benchmark is a
   **blocker**, not a wording problem: it fails Gate D.

The check is a review step here because this milestone's file scope is Markdown only — a CI-enforced
version needs a script and a workflow step, which is recorded as follow-up work in `PROGRESS.md`
rather than claimed.

## Deliverables

| File | Notes |
|------|-------|
| `warsha-demo-ar.mp4` | Arabic narration, burned-in Arabic captions, 1920×1080, 30 fps |
| `warsha-demo-en.mp4` | English narration from the same frames |
| `warsha-demo-poster-ar.png`, `warsha-demo-poster-en.png` | Poster frames for the hero embed |
| `warsha-demo-chapters.md` | Chapter list: Install · Provider · New project · Gates A–C · Repository |

Upload unlisted, attach to the Gate D card with the claims table above filled in, and publish by
hand once the owner approves. The launch posts in `docs/social/calendar.md` keep their `{{video_url}}`
placeholder until then.
