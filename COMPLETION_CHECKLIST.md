# Warsha Completion Checklist - Tracked Document

**Status:** Active - Updated 2026-11-12  
**Purpose:** Durable completion checklist and evidence summary (tracked, secret-free)  
**Related:** bridge-io/policy/2026-11-09-completion-program/ (gitignored, contains detailed evidence)

---

## 📋 Completion Program Overview

This document tracks the high-level completion status of Warsha's completion program as defined in `bridge-io/policy/2026-11-09-completion-program/PROGRAM_PLAN.md`.

**Program Goal:** Take Warsha from current state to complete and verified by design, code, function, system, and security tests.

**Runs:**
- **R0** - Finish UI v3 (target: 0.3.0)
- **R1** - Dependency and supply-chain security (target: 0.3.1)
- **R2** - Extensions: MCP, Plugins, Skills, WebMCP (target: 0.4.0)
- **R3** - Self-hosting (target: 0.5.0)
- **R4** - Cleanup and full verification (target: 1.0.0-rc, draft only)

---

## ✅ Completed Items

### Security Commits Integration
- [x] **Commit 15b99f9** - docs(program): checkpoint records through 2026-11-10 (R0 C3 partial + KEEL K1-K4)
  - **Status:** ✅ In warsha-dev/dev remote
  - **Evidence:** `git log --oneline warsha-dev/dev | grep 15b99f9`
  
- [x] **Commit 361c38b** - fix(security): refuse an unlisted Origin on the RPC listener (HTTP and WS)
  - **Status:** ✅ In warsha-dev/dev remote
  - **Evidence:** `git log --oneline warsha-dev/dev | grep 361c38b`
  
- [x] **Commit 285105e** - chore(security): exempt the K5/H1H2 synthetic test secrets by exact value
  - **Status:** ✅ In warsha-dev/dev remote
  - **Evidence:** `git log --oneline warsha-dev/dev | grep 285105e`
  
- [x] **Commit 2942811** - fix(security): make the CLI config file owner-only on Unix
  - **Status:** ✅ In warsha-dev/dev remote
  - **Evidence:** `git log --oneline warsha-dev/dev | grep 2942811`

### Research Completed
- [x] **CSP/Webview Token Research** - Completed 2026-11-12
  - **Findings:** 7 security issues identified (3 HIGH, 4 MEDIUM)
  - **Files Analyzed:** tauri.conf.json, warshad/src/lib.rs, warshad/src/auth.rs, desktop/src-tauri/src/lib.rs, docs/src/security.md
  - **Evidence:** Research report in task a54f54065cf3196fa
  
- [x] **Daemon Wiring Research (E2/E3/E5)** - Completed 2026-11-12
  - **Findings:** Partial implementations with critical wiring gaps
  - **Files Analyzed:** warshad/src/lib.rs, warsha-pipeline/src/agent_loop.rs, warsha-git/src/lib.rs, warsha-core/src/lib.rs
  - **Evidence:** Research report in task af889cf1cd8c5715c

### Code Changes
- [x] **warsha-git E3a helpers** - Added verify_clean_git_repo and init_project_repo
  - **Status:** ✅ Compiles successfully (`cargo check` passed)
  - **Files Modified:** crates/warsha-git/src/lib.rs (+431 lines)
  - **Purpose:** Foundation for E3 worktree management

---

## 🔄 In Progress Items

### CSP/Webview Token Fixes (HIGH PRIORITY)
- [ ] **Fix desktop CSP** - Remove 'unsafe-inline' and 'unsafe-eval' from tauri.conf.json
  - **File:** apps/desktop/src-tauri/tauri.conf.json
  - **Owner:** Full-stack Engineer (agent ab809bc8496786719)
  - **Status:** In progress (background)
  
- [ ] **Add CSP for remote app** - Implement CSP headers for PWA
  - **Files:** apps/remote/ (TBD based on framework)
  - **Owner:** Full-stack Engineer
  - **Status:** Pending
  
- [ ] **Windows token file permissions** - Add explicit permissions on Windows
  - **File:** crates/warshad/src/lib.rs (around lines 3492-3513)
  - **Owner:** Full-stack Engineer
  - **Status:** Pending
  
- [ ] **Add CSP headers to daemon** - Add CSP headers to HTTP responses
  - **File:** crates/warshad/src/lib.rs (around lines 5573-5645)
  - **Owner:** Full-stack Engineer
  - **Status:** Pending
  
- [ ] **Restrict connect-src ports** - Replace wildcards with specific daemon ports
  - **File:** apps/desktop/src-tauri/tauri.conf.json
  - **Owner:** Full-stack Engineer
  - **Status:** Pending

### Daemon Wiring (E2/E3/E5)
- [ ] **E2: Merge agent sessions seam** - Move RunAgentSessions from worktree to main
  - **Files:** .qoder/worktrees/.../agent_sessions.rs → warsha-pipeline/src/agent_sessions.rs
  - **Status:** Seam implemented in worktree (4 tests passing), needs merge
  
- [ ] **E2: Wire per-run agent loop** - Integrate RunAgentSessions into daemon
  - **Files:** warshad/src/lib.rs, warsha-pipeline/src/lib.rs
  - **Status:** Seam ready, wiring pending
  
- [ ] **E3: projects.attach RPC** - Add method to attach existing git repos
  - **Files:** warshad/src/lib.rs, warsha-core/src/lib.rs
  - **Status:** Git helpers done (verify_clean_git_repo, init_project_repo), attach RPC pending
  
- [ ] **E3: Merge worktree seam** - Move worktree management from worktree to main
  - **Files:** .qoder/worktrees/.../worktree.rs → warsha-pipeline/src/worktree.rs
  - **Status:** Seam implemented in worktree (4 tests passing), needs merge
  
- [ ] **E3: Wire per-run worktree creation** - Integrate worktree creation into runs.start
  - **Files:** warshad/src/lib.rs, warsha-pipeline/src/lib.rs
  - **Status:** Seam ready, wiring pending
  
- [ ] **E5: Merge gate evidence seam** - Move gate_evidence from worktree to main
  - **Files:** .qoder/worktrees/.../gate_evidence.rs → warsha-pipeline/src/gate_evidence.rs
  - **Status:** Seam implemented in worktree (5 tests passing), needs merge
  
- [ ] **E5: Wire Gate C evidence collection** - Integrate evidence collection into Gate C
  - **Files:** warshad/src/lib.rs, warsha-pipeline/src/lib.rs
  - **Status:** Seam ready, wiring pending

---

## ⏳ Pending Items

### Secret Scans and Security
- [ ] **Run gitleaks full scan** - Verify no secrets in tracked files
  - **Status:** Main workspace clean (only worktree leaks found, which are gitignored)
  - **Evidence:** gitleaks scan 2026-11-12 found 12 leaks in .qoder/worktrees/ (all acceptable)
  
- [ ] **Run cargo deny check** - Verify dependency security
  - **Status:** Pending
  
- [ ] **Run pnpm audit** - Verify JS dependency security
  - **Status:** Pending

### Testing
- [ ] **Run cargo test --workspace** - Verify Rust tests pass
  - **Status:** Pending
  
- [ ] **Run pnpm -r test** - Verify TypeScript tests pass
  - **Status:** Pending
  
- [ ] **Run pnpm -r typecheck** - Verify TypeScript types
  - **Status:** Pending
  
- [ ] **Run cargo fmt --all --check** - Verify formatting
  - **Status:** Pending
  
- [ ] **Run cargo clippy --workspace --all-targets -- -D warnings** - Verify linting
  - **Status:** Pending

### Integration and Push
- [ ] **Integrate changes into dev branch** - Commit verified changes
  - **Status:** warsha-git changes ready, CSP changes pending
  
- [ ] **Review staged diff** - Verify all changes before push
  - **Status:** Pending
  
- [ ] **Push dev to warsha-dev remote** - Push verified commits
  - **Status:** Pending (requires GitHub credentials)

---

## 📊 Verification Matrix Status

Based on PROGRAM_PLAN.md §5 (Definition of Done):

| Dimension | Gate | Status | Notes |
|-----------|------|--------|-------|
| **Design** | contrast.mjs, check-ds-v3 lint, simplicity spec, visual baselines, axe 0 violations | ⏳ Pending | UI v3 work in progress |
| **Code** | fmt, clippy -D warnings, typecheck, lint, format, check-arch, wire contract, policy | ⏳ Pending | Need to run gates |
| **Functions** | cargo test, pnpm -r test, actions-gate, Playwright pw-gate, CLI smoke, MCP loopback | ⏳ Pending | Need to run tests |
| **System** | installers, --self-check, daemon+CLI+desktop+remote paired, mock-provider greenfield | ⏳ Pending | System tests pending |
| **Security** | cargo deny, pnpm audit, gitleaks, approval/pin/secret-scope tests, redaction tests | ⚠️ Partial | gitleaks clean, others pending |
| **Release truth** | versions aligned, release bundle staged as draft | ⏳ Pending | Version check pending |

---

## 🎯 Current Focus Areas

### Immediate (Next 24 hours)
1. **Complete CSP/webview token fixes** - HIGH priority security issues
2. **Run secret scans** - Verify security posture
3. **Run basic tests** - Verify no regressions
4. **Create tracked evidence summary** - This document

### Short-term (Next week)
1. **Implement E2/E3/E5 daemon wiring** - Critical for ENGINE phase
2. **Complete KEEL security packets** - K4, K5, K6, K7, K8, K9
3. **Finish UI v3** - R0 completion
4. **Run full verification matrix** - All gates green

### Blockers
1. **GitHub credentials** - Required for push to warsha-dev remote
   - **Impact:** Cannot push dev branch
   - **Workaround:** Local verification only
   
2. **Team review blockers** - Block only dependent gates, not unrelated work
   - **Impact:** Some items blocked, but unblocked work can continue
   
3. **Windows blockers** - Block only dependent gates
   - **Impact:** Some items blocked, but unblocked work can continue
   
4. **Staging blockers** - Block only dependent gates
   - **Impact:** Some items blocked, but unblocked work can continue

---

## 📝 Evidence Summary

### Security Evidence
- **gitleaks scan**: 2026-11-12, main workspace clean, 12 leaks in .qoder/worktrees/ (all gitignored, acceptable)
- **Security commits**: 4 commits verified in warsha-dev/dev remote
- **CSP research**: 7 issues identified with priority rankings
- **Daemon wiring research**: Gaps identified in E2, E3, E5

### Code Evidence
- **warsha-git changes**: +431 lines, compiles successfully (E3a git helpers)
- **CSP fixes**: Implementation in progress (background agent ab809bc8496786719)
- **Daemon wiring**: Research completed, seams found in worktrees
  - E2: RunAgentSessions seam with 4 passing tests in worktree
  - E3: worktree.rs seam with 4 passing tests + git helpers in main
  - E5: gate_evidence.rs seam with 5 passing tests in worktree

### Test Evidence
- **warsha-git**: `cargo check` passed
- **Full test suite**: Pending

---

## 🔗 Related Documents

### Tracked Documents (in repository)
- [`PLAN.md`](PLAN.md) - Historical plan and decisions
- [`PROGRESS.md`](PROGRESS.md) - Detailed build log and progress
- [`DECISIONS.md`](DECISIONS.md) - Owner decisions and rationale
- [`ENGINEERING_POLICY.md`](ENGINEERING_POLICY.md) - Engineering policies and rules
- [`SECURITY.md`](SECURITY.md) - Security policies and threat model

### Gitignored Documents (in bridge-io/)
- `bridge-io/policy/2026-11-09-completion-program/PROGRAM_PLAN.md` - Detailed program plan
- `bridge-io/policy/2026-11-09-completion-program/MASTER_PROMPT.md` - Orchestrator prompt
- `bridge-io/policy/2026-11-09-completion-program/PARK.md` - Parked state manifest
- `bridge-io/policy/2026-11-10-keel/state.json` - KEEL run state
- `bridge-io/policy/2026-11-10-keel/acceptance.json` - KEEL acceptance gates
- `bridge-io/policy/2026-11-11-release/CHECKLIST.md` - Release checklist

---

## 📅 Last Updated

- **2026-11-12 18:19:36Z** - User request received
- **2026-11-12 18:20:00Z** - Security commits verified
- **2026-11-12 18:25:00Z** - CSP research completed
- **2026-11-12 18:30:00Z** - Daemon wiring research completed
- **2026-11-12 18:35:00Z** - This document created

---

## 💡 Notes

1. **Private evidence**: Raw evidence (logs, screenshots, detailed reports) remains in gitignored bridge-io/ directory
2. **Public evidence**: This document contains only secret-free, high-level status suitable for tracking
3. **Durability**: This document is tracked in git and will persist across worktree cleanups
4. **Completeness**: For detailed evidence, refer to the gitignored bridge-io/ documents

---

*This document is maintained by the Software Dev Team as part of the Warsha completion program.*
