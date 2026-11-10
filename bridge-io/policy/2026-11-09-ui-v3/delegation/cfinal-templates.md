# C-final record templates (fill at C-final only; orchestrator owns these writes)

## verdict.json skeleton (warsha-run/v1 verdict)
{
  "schema": "warsha-run/v1#verdict",
  "run_id": "2026-11-09-ui-v3",
  "verdict": "ready-for-acceptance",
  "reason": "<one paragraph: gate tally pass/fail/not-run with log pointers; refreshes done with owner words; U7 state; human-only list>",
  "integration_tip": "<40-hex>",
  "run_base": "ba90e713b2731870a7df3c1791bcbfe98e330717",
  "release_version": "0.3.0",
  "gates": { "total": 161, "pass": 0, "fail": 0, "not_run": 0 },
  "refreshes": [ { "id": "R0", "status": "done", "owner_word": "<utterance+time>", "commit": "<hex>" } ],
  "owner_decisions": { "OD-U0": "yes", "OD-U1": "review-each", "OD-U2": "C", "OD-U3": "<ask-at-U7|yes>", "OD-B3": "0.3.0", "OD-B4": "defer", "OD-B6": "no", "OD-F1": "approve-scoped" },
  "human_only": [ "Windows Authenticode / Apple Developer ID signing", "Tauri updater key+endpoint", "GitHub environment protection", "merge to main / tag / push / publish" ],
  "uncovered": [ "<e.g. GC.14 if java absent: apksigner verify not run, aapt2 badging only>", "<any not-run gate with reason>" ],
  "ancestry_check": "git merge-base --is-ancestor dev run/2026-11-09-ui-v3/integration => <exit>",
  "timestamp": "<UTC>"
}

## RELEASE_NOTES.md skeleton (ar first, then en)
# Warsha <V> — مسودة محلية / local draft
## بالعربية
- واجهة v3 «حِرفة» beside/حسب OD-U3: <Simple/Workbench/Settings/PWA summary>.
- إصلاحات: harness truth (H1)، تصليب Rust (R1)، صدق الإصدار (V1)، <F1 scoped waiver note>.
- الأساسات: R0/RH1/RU3–RU6 بكلمات المالك؛ <counts>.
- غير مشمول/بشري: التوقيع، updater، حماية environment، الدمج والنشر.
## English
- <mirror of the above, same facts>.
- Verification: <gate tally>, Playwright <listed>/<passed>, SBOMs + checksums in upload/.

## RELEASE_MANIFEST.json skeleton
{ "version": "<V>", "tip": "<hex>", "artifacts": [ { "name": "<upload entry>", "sha256": "<from checksums.sha256>", "bytes": 0 } ], "sboms": ["sbom-cli.cdx.xml","sbom-daemon.cdx.xml"], "draft": true, "published": false }

## CREATE_DRAFT_RELEASE.md skeleton
- Local draft only. Nothing uploaded/pushed/tagged. Owner steps: review od-visual packs + verdict.json, then merge/tag/publish at will.
- Bundle layout mirrors v0.2.0: upload/ + checksums.sha256 + notes + manifest.