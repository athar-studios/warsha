# A3 — Usage analysis, quotas, and alerts

Packet: A3 (cap 20) · Plan: docs/zadloop/R-NEXT-MASTER-PLAN.md @ 8b336a0 (v5, §A3 :753-784) · Branch: `r-next/a3-usage-analysis` · Worktree: `.agents/worktrees/rn-a3`

## Deliveries

1. **Cost/usage aggregates in the store** (crates/warsha-store/src/lib.rs):
   - `aggregate_costs_by(dimension, project_id: Option<ProjectId>)` — dimension whitelist `["provider_id","model_id","agent_role","project_id"]`, invalid dimension → `StoreError::UnexpectedType("invalid dimension")` (never interpolates arbitrary input).
   - `aggregate_tokens_by(dimension, time_format, project_id)` — `"%Y-%m-%d"` (day) or `"%Y-%m"` (month) whitelist; groups by (dimension, period); returns `(prompt, completion, cache_read, cache_write, requests)` sums via `SUM` + `COUNT(*)`.
   - `aggregate_costs_by_time(time_format, project_id)` — period → cost_cents.
   - `costs_in_window(window)` — whitelist `"5h"`/`"7d"`; RFC 3339 cutoff (matches `record_cost`'s `to_rfc3339` storage); returns `(requests, cost_cents)`.
2. **ProviderQuota + get_quota** (warsha-core, warsha-providers): `ProviderQuota { Reported{used,limit}, Estimated{usage_percentage}, Unknown }`; `get_quota()` on the `ChatProvider` trait; OpenRouter implemented over `GET {api_base}/key` → `Reported`; other providers return `Unknown` (no invented limits). `ProviderKind` threaded through `OpenAIProvider::new(id, kind, …)` and the daemon factory.
3. **Usage + quota RPC** (warshad): `providers.quota(name)`, `usage.by_dimension(dimension, project_id?)`, `usage.by_time(granularity, project_id?)`, `usage.subscription_window()`; policy rows `providers.quota` Owner/Spend, usage.* Session/Standard (auth.rs).
4. **Client methods** (packages/client/src/index.ts): `usageByDimension`, `usageByTime`, `providerQuota`, `usageSubscriptionWindow` with strict wire decoding (`nonNegativeInt`, `decodeWindowUsage`; malformed → named errors).
5. **Usage and quotas settings section** (apps/desktop): `UsageSection.tsx` (data-testid `settings-section-usage`) — dimension switch (provider/model/role/project), day/month granularity tables, per-provider quota rows with a check action, 3-state quota rendering, subscription-window rows (`usage-window-5h`/`usage-window-7d`, labelled estimated). Registry + nav contract updated 15→16 advanced sections.
6. **Status-bar quota gauge** (Frame): `QuotaGaugeButton` renders `Gauge` (exported from `@warsha/ui/v3`, rewritten without the undeclared `clsx` dep) driven by `useQuotaGauge` — tightest-known-quota wins (red > amber > green, ties by higher percentage), configurable thresholds (`DEFAULT_GAUGE_THRESHOLDS {amber:60, red:80}`), unknown quotas never drive the colour, click opens the usage tab. Polling: 5-min interval, in-flight guard (never overlapping rounds), **stops while the window is hidden** and resumes on `visibilitychange`.
7. **Alerts once per crossing**: `CrossingTracker` + `isCrossing` in `app/quotaAlerts.ts` fire `notify({type:'warning'})` through the existing toast surface only on an upward threshold crossing (80%); a dip clears the mark so a later re-crossing fires again. Wired into the gauge poll loop.
8. **Subscription windows** (A16): rolling 5-hour + 7-day windows estimated from the daemon's own cost records (`usage.subscription_window` → `SubscriptionWindow{five_hour, seven_day}`), rendered with the estimated label — the provider exposes no limit, and none is invented (A3 spec).
9. i18n ar+en for every new string (settings.usage.* incl. windows + thresholds); i18n gate 876 keys, 0 violations.

## VERIFY evidence

- **OpenRouter quota endpoint** (plan-mandated VERIFY): `GET https://openrouter.ai/api/v1/key` with `Authorization: Bearer` returns `data.limit`/`data.usage` (documented in OpenRouter's keys API); implemented against that shape with a local stub in tests — no live call in tests (mock-provider rule).
- **Provider limits**: providers without a documented balance endpoint return `Unknown`; the UI renders "unknown" rather than a zero or an invented limit (A3 spec).

## Tests and gates (all run in rn-a3)

| Gate | Result |
| --- | --- |
| cargo fmt --check | clean (after `cargo fmt`) |
| cargo clippy -p warshad -p warsha-store -p warsha-pipeline --all-targets -D warnings | 0 warnings |
| cargo test -p warsha-store --lib | 26 passed, 0 failed |
| cargo test -p warshad --all-targets | 252 passed, 0 failed (+ all suites green) |
| pnpm --filter @warsha/client test | 193 passed |
| pnpm --filter @warsha/i18n test | 58 passed |
| pnpm --filter @warsha/ui test | 383 passed |
| pnpm --filter warsha-desktop test | 870 passed (99 files; incl. 10 gauge + 6 alert unit tests) |
| pnpm --filter warsha-desktop typecheck | rc=0 |
| node scripts/ci/i18n-gate.mjs . | 876 keys, 0 violations |
| node scripts/check-arch.mjs | 5/0 |
| node scripts/check-engineering-policy.mjs | 8/0 |

## Notes for A4/E-series

- `ProviderQuotaStatus.checked_at` carries the check time for stale-with-age rendering (E-series may build on it).
- Gauge thresholds are in-component constants (`DEFAULT_GAUGE_THRESHOLDS`); making them owner-configurable via preferences is left as a follow-up (A3 spec's "configurable" is satisfied by the exported threshold seam + unit tests).
- Polling is a single 5-min gauge round + on-demand quota checks from the section; no new background polling loops.

## Owner checklist

- (7) Live balance checks against real provider endpoints remain owner-side; all packet tests use local stubs.
