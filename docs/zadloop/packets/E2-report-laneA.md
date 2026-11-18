# Packet E2 Lane A Report - Secretary Chat Backend & Remote Bind Daemon Setting

## 1. Overview & Scope
Implements and verifies E2 Lane A on worktree `.agents/worktrees/rn-e2` (branch `r-next/e2-secretary`):
- **Secretary Chat Backend**: Multi-turn conversation management, read-only snapshot retrieval, context summarization trigger when conversation exceeds 40 turns, untrusted data injection protection, proposal generation & authorization validation, and role-based daily cost cap enforcement (`Role::Secretary`).
- **Remote Bind Daemon Setting**: Network binding mode configuration (`Default`, `Localhost`, `Tailscale`) with fail-closed security for unresolvable interfaces.
- **Wire Contract & Authorization**: JSON-RPC endpoints registered under appropriate auth policies (`Owner`/`Spend` for interactive turns, `Session`/`Standard` for thread listing and turn reads).

---

## 2. Changed Files

### `crates/warshad`
- `crates/warshad/src/secretary_chat.rs`:
  - `SecretaryChat` engine with model routing, cost tracking, context compaction, and read-only snapshot construction.
  - Hardened proposal validation: checks `references_owner_turn` against owner turns in the conversation, enforces bilingual action intent matching (English and Arabic: `approve`/`وافق`, `reject`/`ارفض`, `allow`/`اسمح`, `start`/`ابدأ`, `cancel`/`أوقف`), rejects empty or `"unknown"` identifiers, and sets thread `project_id` for nil project actions.
  - Enforced daily cap check (`today_role_cost_cents >= daily_cap_cents -> DailyLimitReached`) before invoking the model for summarization or chat turns.
  - Untrusted data warning in system prompt marking snapshot/queue/artifact content as quoted data.
- `crates/warshad/src/tests/secretary_chat.rs`:
  - 10 targeted tests covering:
    - Serde wire round-trip for all 5 `ProposalAction` variants in snake_case format (`gate_approve`, `gate_reject`, `queue_decide`, `run_start`, `run_cancel`).
    - Proposal refusal when `references_owner_turn` is missing, points to non-owner turn, has prompt injection/untrusted data, or has `"unknown"`/empty target IDs.
    - Proposal acceptance when owner explicitly requests action in EN or AR.
    - Daily limit enforcement (`SecretaryChatError::DailyLimitReached`).
    - Global thread cost recording with `ProjectId(Uuid::nil())`.
    - Context summarization triggered when turn count > 40 turns (persists summary, updates `covers_until`, records summarizer model spend).
    - Read-only snapshot content verification (`daily_cap_cents`, `today_spend_cents`, `active_runs`, `pending_gates`, `pending_ask_queue`).
    - RPC auth policy checks (`secretary.thread.list`, `secretary.thread.turns`, `secretary.chat`).
- `crates/warshad/src/http.rs`:
  - `resolve_bind_addr` implementation with `RemoteBind` options (`Default`, `Localhost`, `Tailscale`).
  - Unit tests verifying interface resolution and fail-closed behavior on missing Tailscale interface.
- `crates/warshad/src/settings.rs`:
  - Restored `delete_integration` method.
  - Implemented `SettingsProvider` for `SettingsStore`.
  - Added `load_remote_bind` and `save_remote_bind` preference helpers.
- `crates/warshad/src/state.rs`:
  - `RemoteBind` enum (`#[serde(rename_all = "snake_case")]`) and `DaemonConfig::remote_bind`.
- `crates/warshad/src/api.rs`:
  - Registered `secretary.chat`, `secretary.thread.list`, and `secretary.thread.turns` RPC handlers.
- `crates/warshad/src/auth.rs`:
  - Configured `MethodPolicy` for secretary RPCs: `secretary.chat` as `Policy::Owner` / `Tier::Spend`, and `secretary.thread.*` as `Policy::Session` / `Tier::Standard`.
- `crates/warshad/src/lib.rs`:
  - Re-exported `RemoteBind` and wired `SecretaryChat` initialization with `mcp_approvals`.

### `crates/warsha-cli`
- `crates/warsha-cli/tests/cli_rpc_auth.rs`:
  - Updated test daemon config to use `warshad::RemoteBind::Default`.
- `crates/warsha-cli/tests/mcp_serve.rs`:
  - Updated test daemon config to use `warshad::RemoteBind::Default`.

### `crates/warsha-store`
- `crates/warsha-store/migrations/018_secretary_chat.sql`:
  - Schema migration for `secretary_conversations`, `secretary_turns`, and `secretary_summaries`.
- `crates/warsha-store/src/secretary_chat.rs` & `crates/warsha-store/src/lib.rs`:
  - CRUD operations for conversations, turns, and summaries.
- `crates/warsha-store/tests/secretary_chat.rs`:
  - Integration tests for migration and storage round-trips.

---

## 3. Wire Contract & Security Guarantees

### RPC Methods & Authorization
| Method | Policy | Tier | Notes |
|---|---|---|---|
| `secretary.chat` | `Owner` | `Spend` | Requires Owner token/secret, tracked under Secretary daily cap |
| `secretary.thread.list` | `Session` | `Standard` | Paired sessions can list thread IDs |
| `secretary.thread.turns` | `Session` | `Standard` | Paired sessions can read thread history |

### Proposal Actions (Externally Tagged `snake_case`)
- `gate_approve`: `{"gate_approve":{"run_id":"...","stage":"..."}}`
- `gate_reject`: `{"gate_reject":{"run_id":"...","stage":"...","reason":"..."}}`
- `queue_decide`: `{"queue_decide":{"question_id":"...","allow":true}}`
- `run_start`: `{"run_start":{"project_id":"...","idea":"..."}}`
- `run_cancel`: `{"run_cancel":{"run_id":"..."}}`

### Security & Invariant Protections
1. **Prompt Injection & Untrusted Data**: Read-only snapshot and artifacts are framed as untrusted quoted data in the system prompt. Models are strictly forbidden from executing instructions contained within snapshot data.
2. **Proposal Authorization**: Secretary cannot emit a proposal on its own. Proposals require an owner turn explicitly asking for that action (in EN or AR) with matching IDs. Mismatched or `"unknown"` IDs fail closed (`proposal: None`).
3. **Spend Limits**: Daily cap is checked before any model invocation. Reaching the cap immediately errors with `SecretaryChatError::DailyLimitReached` without incurring API charges. Costs are recorded for both project-scoped threads and global (`nil`) threads under `Role::Secretary`.
4. **Network Fail-Closed**: When configured with `RemoteBind::Tailscale`, daemon refuses to fall back to `0.0.0.0` or `127.0.0.1` if no Tailscale interface is found (`DaemonError::Config`).

---

## 4. Verification Evidence

### Exact Gate Command Results
- **Code Formatting**:
  `CARGO_HOME=/tmp/cargo-home cargo fmt --check` -> **Passed** (exit code 0, no output)
- **Clippy Analysis**:
  `CARGO_HOME=/tmp/cargo-home cargo clippy --workspace --all-targets -- -D warnings` -> **Passed** (exit code 0, 0 warnings/errors)
- **Targeted Test Suites**:
  `CARGO_HOME=/tmp/cargo-home cargo test -p warsha-store -p warshad -p warsha-cli` -> **Passed** (exit code 0)
  - `warsha-store`: 26 unit tests + 1 secretary_chat test + 19 settings tests + 5 migration tests passed.
  - `warshad`: 273 library unit tests (including all 10 `secretary_chat_tests` and 5 `remote_bind` tests) + 14 integration test suites passed.
  - `warsha-cli`: 16 unit tests + 4 cli_rpc tests + 7 cli_rpc_auth tests + 2 mcp_serve tests + 3 permission_bridge tests passed.
