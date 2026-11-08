<!-- Source of truth: docs/designs/DESIGN_SYSTEM_V2.md (planner-owned design; this shim only publishes it in the book). -->
<!-- Why the include below is split in three: the source's layout diagram (source lines 76-103) is a code fence with no language, which mdbook test compiles as Rust and fails. Re-opening exactly that fence as text here fixes the book without editing the planner-owned source. The line ranges are pinned to the source; if the source moves, move them with it. If the source fence is ever annotated in place, this can go back to one plain include. -->
> **Implementation status at `406240a`:** W3 is merged; W5 (app adoption) is not. The v2 token
> modules `lines.ts`, `elevation.ts` and `breakpoints.ts` exist (`breakpoints.ts` is TypeScript-only,
> because a media query cannot read a custom property), and `tokens.css` carries their properties —
> including `--warsha-line-rule`. `tokenDrift.test.ts` enforces R6.1–R6.10; its app length ratchet has
> `APP_LENGTH_BUDGET = 145` (142 lengths plus 3 literal `var()` fallbacks, measured at W3's base
> `5abe5ef`), and `WARSHA_R6_APP_LENGTH_BUDGET` can only tighten it. The screen and adoption sections
> below remain targets until W5 lands.

{{#include ../designs/DESIGN_SYSTEM_V2.md:1:75}}
```text
{{#include ../designs/DESIGN_SYSTEM_V2.md:77:102}}
```
{{#include ../designs/DESIGN_SYSTEM_V2.md:104:}}
