#!/usr/bin/env bash
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# scripts/wsl-setup.sh — Warsha M0 toolchain bootstrap + validation for WSL2 Ubuntu.
#
# Run INSIDE WSL2 Ubuntu from the project root (default ~/warsha):
#   bash scripts/wsl-setup.sh
#
# Every step is logged to wsl-validation.log and PROGRESS.md is NOT edited
# automatically — paste the log into PROGRESS.md afterwards.

set -uo pipefail

LOG="${PWD}/wsl-validation.log"
: >"$LOG"

log()   { printf '%s\n' "$*" | tee -a "$LOG"; }
step()  { log ""; log "=== $* ==="; }
record() { # record <label> <exit-code> <command...>
  local label="$1" code="$2"; shift 2
  if [ "$code" -eq 0 ]; then log "PASS  $label  (\$ $*)"; else log "FAIL  $label  (exit $code)  (\$ $*)"; fi
}
run() { # run <label> <command...>
  local label="$1"; shift
  step "$label"
  "$@" 2>&1 | tee -a "$LOG"
  local code="${PIPESTATUS[0]}"
  record "$label" "$code" "$*"
  return "$code"
}

FAILED=0
run_soft() { run "$@" || FAILED=1; }

log "warsha M0 validation — $(date -u +%Y-%m-%dT%H:%M:%SZ) — $(lsb_release -ds 2>/dev/null || uname -a)"

# ---------------------------------------------------------------- 0. sanity
step "sanity check: project layout"
for required in Cargo.toml pnpm-workspace.yaml package.json .github/workflows/ci.yml; do
  if [ -e "$required" ]; then log "PASS  found $required"; else log "FAIL  missing $required (wrong directory?)"; FAILED=1; fi
done

# ------------------------------------------------------------ 1. apt basics
step "apt: base build dependencies"
sudo apt-get update -y 2>&1 | tail -n 5 | tee -a "$LOG"
sudo apt-get install -y build-essential pkg-config libssl-dev curl git unzip ca-certificates 2>&1 | tail -n 5 | tee -a "$LOG"
record "apt base dependencies" "${PIPESTATUS[0]}" "apt-get install build-essential pkg-config libssl-dev curl git unzip"

# ---------------------------------------------------------------- 2. rustup
step "rustup: stable toolchain"
if ! command -v rustup >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable 2>&1 | tail -n 5 | tee -a "$LOG"
fi
# shellcheck disable=SC1091
. "$HOME/.cargo/env" 2>/dev/null || true
rustup component add rustfmt clippy 2>&1 | tee -a "$LOG"
record "rustup stable + rustfmt + clippy" "$?" "rustup component add rustfmt clippy"

# -------------------------------------------------------- 3. node 20 via nvm
step "nvm + Node.js 20"
export NVM_DIR="$HOME/.nvm"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash 2>&1 | tail -n 5 | tee -a "$LOG"
fi
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm install 20 2>&1 | tee -a "$LOG"
nvm use 20     2>&1 | tee -a "$LOG"
record "nvm install 20 / node $(node --version 2>/dev/null)" "$?" "nvm install 20"

# ------------------------------------------------------- 4. corepack + pnpm
step "corepack + pnpm 9"
corepack enable 2>&1 | tee -a "$LOG"
corepack prepare pnpm@9 --activate 2>&1 | tee -a "$LOG"
record "corepack prepare pnpm@9 (pnpm $(pnpm --version 2>/dev/null))" "$?" "corepack prepare pnpm@9 --activate"

# ------------------------------------------------------------ 5. actionlint
step "actionlint"
AL_VERSION="1.7.7"
if ! command -v actionlint >/dev/null 2>&1; then
  tmp="$(mktemp -d)"
  if curl -sSfL "https://github.com/rhysd/actionlint/releases/download/v${AL_VERSION}/actionlint_${AL_VERSION}_linux_amd64.tar.gz" -o "$tmp/actionlint.tgz"; then
    tar -xzf "$tmp/actionlint.tgz" -C "$tmp"
    sudo install -m 0755 "$tmp/actionlint" /usr/local/bin/actionlint
  fi
  rm -rf "$tmp"
fi
record "actionlint installed ($(actionlint --version 2>/dev/null | head -n 1))" "$?" "actionlint --version"

# ----------------------------------------------------------------- 6. mdbook
# The `docs` workspace package builds and tests with the mdbook binary, which is
# a cargo tool, not an npm dependency. CI installs it the same way.
# Pinned to match `docs/book.toml`, which uses the mdbook 0.5 config layout
# (`[build] build-dir`). An unpinned `cargo install` would eventually drift and
# turn a green docs build red without any change in this repo.
MDBOOK_VERSION="0.5.4"
step "mdbook"
if ! command -v mdbook >/dev/null 2>&1; then
  cargo install mdbook --version "$MDBOOK_VERSION" --locked 2>&1 | tail -n 5 | tee -a "$LOG"
fi
record "mdbook installed ($(mdbook --version 2>/dev/null | head -n 1))" "$?" "mdbook --version"

# --------------------------------------------------------------- 7. checks
run_soft "cargo fmt --check"                        cargo fmt --all --check
run_soft "cargo clippy --workspace -- -D warnings"  cargo clippy --workspace --all-targets -- -D warnings
run_soft "cargo test --workspace"                   cargo test --workspace
run_soft "pnpm install"                             pnpm install
run_soft "pnpm -r typecheck"                        pnpm -r typecheck
run_soft "pnpm -r build"                            pnpm -r build
run_soft "pnpm -r test"                             pnpm -r test
run_soft "actionlint ci.yml"                        actionlint .github/workflows/ci.yml

# --------------------------------------------------------------- summary
step "SUMMARY"
if [ "$FAILED" -eq 0 ]; then
  log "RESULT: M0 validation PASSED — all checks green."
else
  log "RESULT: M0 validation FAILED — see FAIL lines above."
fi
log "Full log: $LOG"
exit "$FAILED"
