#!/usr/bin/env bash
# KEEL scope gate wrapper — EV/tools/scope.sh <PACKET-ID>
# Verifier tooling (does not touch product code). Per-packet base/head/worktree/allowlist.
set -uo pipefail

PKT="${1:-}"

case "$PKT" in
  K1)
    BASE=128b59c08cbf5ddbe4de002528a50f451ea74296
    HEAD=bef00eb203f98973fb157a789f278b38e27862f4
    WT="${KEEL_WORKTREE:-C:/Users/Dragonfly/Downloads/warsha-wt/keel/k1}"
    ;;
  K2)
    BASE=ced5e30479610fcc4fb196d3039463e284dedefb
    HEAD=718e859
    WT="${KEEL_WORKTREE:-C:/Users/Dragonfly/Downloads/warsha-wt/keel/k2}"
    ;;
  K3)
    BASE=e6b3e6debd23ceb27f6547a483af5392a5faaaaf
    HEAD=bc157e1
    WT="${KEEL_WORKTREE:-C:/Users/Dragonfly/Downloads/warsha-wt/keel/k3}"
    ;;
  *)
    echo "scope: unsupported packet '$PKT' (extend this wrapper with the packet's base/head/worktree/allowlist)" >&2
    exit 2
    ;;
esac

cd "$WT" || { echo "scope: worktree not found: $WT" >&2; exit 2; }

allowed() {
  case "$PKT" in
    K1)
      case "$1" in
        crates/warsha-pipeline/*)
          case "$1" in *daemon*) return 1 ;; esac
          return 0 ;;
        crates/warsha-core/*)      return 0 ;;
        crates/warshad/src/lib.rs) return 0 ;;
        crates/warshad/tests/*)    return 0 ;;
        *) return 1 ;;
      esac ;;
    K2)
      case "$1" in
        crates/warsha-pipeline/*)  return 0 ;;
        crates/warsha-store/*)     return 0 ;;
        crates/warshad/src/lib.rs) return 0 ;;
        crates/warshad/src/auth.rs) return 0 ;;
        *) return 1 ;;
      esac ;;
    K3)
      case "$1" in
        crates/warsha-pipeline/*)   return 0 ;;
        crates/warshad/src/lib.rs)  return 0 ;;
        crates/warshad/src/wave2.rs) return 0 ;;
        crates/warshad/tests/*)     return 0 ;;
        *) return 1 ;;
      esac ;;
    *) return 1 ;;
  esac
}

tmp=$(mktemp) || exit 2
git diff --name-only "$BASE".."$HEAD" > "$tmp" || { rm -f "$tmp"; exit 2; }

n=0
bad=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  if allowed "$f"; then
    n=$((n + 1))
  else
    bad=$((bad + 1))
    echo "scope-violation: $f"
  fi
done < "$tmp"
rm -f "$tmp"

if [ "$bad" -ne 0 ]; then
  echo "scope-fail $PKT: $bad files outside allowed globs"
  exit 1
fi

echo "scope-ok $PKT: $n files"
exit 0
