#!/usr/bin/env bash
# Install the two IBM Plex families the Linux visual baselines were captured with.
#
# Why this exists: packages/ui/src/tokens/tokens.css leads --warsha-font-sans with
# 'IBM Plex Sans Arabic' and --warsha-font-mono with 'IBM Plex Mono', and nothing is vendored in the
# app (no @font-face, no font byte in the repo), so a host without the families renders every screen
# through the stack's fallbacks. The pixel baselines beside apps/desktop/e2e/*.spec.ts-snapshots were
# made on a host that has them, so on plain ubuntu-latest each case fails on metrics rather than on a
# design change. See bridge-io/audit/visual.md §1 and open finding #10.
#
# Source: the official OFL 1.1 files in the google/fonts repository, pinned to one commit and checked
# against the SHA-256 recorded for each face. Same nine faces and the same install path as the WSL
# capture host, so CI and the baselines agree by construction.
#
# Idempotent: when every face is already in place with the right digest the downloads are skipped and
# only the fontconfig refresh and the family-resolution checks run, so re-running is safe.
set -euo pipefail

COMMIT=6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec
BASE="https://raw.githubusercontent.com/google/fonts/$COMMIT"
TARGET="${WARSHA_CAPTURE_FONT_DIR:-/usr/local/share/fonts/warsha-capture}"

# <path in the google/fonts tree> <sha256 of that blob>
# Sans Arabic carries prose and labels, Mono carries machine data (docs/design/REDESIGN.md §11).
# Medium and SemiBold are separate entries in the name table, so they are installed explicitly rather
# than left to synthesis. Italic is Mono only: Plex Sans Arabic ships no italics.
FACES="ofl/ibmplexsansarabic/IBMPlexSansArabic-Regular.ttf 6f611412270a132bbac838da9259d4c68569b4175f3b3b8fa3fa36a30b56dab9
ofl/ibmplexsansarabic/IBMPlexSansArabic-Medium.ttf b8363ab9f733dfa4f8e96b8b2102c24b5cf4110fb96d1d3d9a9412f6fb49cf74
ofl/ibmplexsansarabic/IBMPlexSansArabic-SemiBold.ttf 597bd5502e5997be4414e4c9c88834b30ff3784250c84f20bce2b20e53ebd467
ofl/ibmplexsansarabic/IBMPlexSansArabic-Bold.ttf 691e0c891a38637ae6bbdb69700f8042cb0724a137bee615068ffdb92244f61f
ofl/ibmplexmono/IBMPlexMono-Regular.ttf 6a3412f058c7d8dfd9170c41e85ade48e5156ecb89356110ca57a0a27734af46
ofl/ibmplexmono/IBMPlexMono-Italic.ttf 3362fc791b0652193328b862c1c5f23a789bc7288b1617fa63302f88689a2a34
ofl/ibmplexmono/IBMPlexMono-Medium.ttf a9b4c49bb299e05b5f6c481e7fb5e78943d2793249a0c8874ab574a2d1ea6755
ofl/ibmplexmono/IBMPlexMono-SemiBold.ttf d3c38e55c78f5b0f28009fddba4834ec503278936a5986032424c9bd2d23aa46
ofl/ibmplexmono/IBMPlexMono-Bold.ttf ac27abd6450a64dd94467580a02fe6235156d5b92f2926ebbc8e7489df64e0be"

# The license travels with the faces it covers. Both directories ship byte-identical OFL 1.1 text.
LICENSES="ofl/ibmplexsansarabic/OFL.txt 7e6b2818edbd8f6a01ae80641cc8f16a51080d08fb4e532be3a0b6f74adb07da
ofl/ibmplexmono/OFL.txt 7e6b2818edbd8f6a01ae80641cc8f16a51080d08fb4e532be3a0b6f74adb07da"

# The families exactly as tokens.css spells them. One per line, because the names contain spaces.
FAMILIES="IBM Plex Sans Arabic
IBM Plex Mono"

FACE_COUNT=$(printf '%s\n' "$FACES" | grep -c .)

fail() {
  echo "install-capture-fonts: $*" >&2
  exit 1
}

have() { command -v "$1" >/dev/null 2>&1; }

if [ "$(id -u)" -eq 0 ]; then
  as_root() { "$@"; }
elif have sudo; then
  as_root() { sudo "$@"; }
else
  fail "$TARGET needs root and sudo is not available"
fi

# A face counts as installed only when the bytes match the pinned digest, so a truncated or
# substituted file can never be mistaken for a clean host.
face_in_place() { # <path in tree> <sha256>
  local candidate="$TARGET/$(basename "$1")"
  [ -f "$candidate" ] || return 1
  [ "$(sha256sum "$candidate" | cut -d' ' -f1)" = "$2" ]
}

# curl -f rejects an error status; this rejects an error body, so a proxy page cannot be installed as
# a font. Accepts TrueType sfnt, CFF and a collection.
assert_font_bytes() {
  local magic
  magic=$(od -An -tx1 -N4 "$1" | tr -d ' \n')
  case "$magic" in
    00010000 | 4f54544f | 74746366) return 0 ;;
    *) fail "$1 is not a font (magic $magic)" ;;
  esac
}

fetch() { # <path in tree> <sha256> <destination dir>
  local name
  name=$(basename "$1")
  curl -fsSL --retry 3 --retry-all-errors --max-time 120 -o "$3/$name" "$BASE/$1"
  [ "$(sha256sum "$3/$name" | cut -d' ' -f1)" = "$2" ] ||
    fail "$name does not match the pinned SHA-256"
  [ "${name##*.}" = ttf ] && assert_font_bytes "$3/$name"
  return 0
}

needs_install=0
while read -r path digest; do
  [ -n "$path" ] || continue
  face_in_place "$path" "$digest" || needs_install=1
done <<< "$FACES"

if [ "$needs_install" -eq 1 ]; then
  TMP=$(mktemp -d)
  trap 'rm -rf "$TMP"' EXIT
  echo "install-capture-fonts: fetching the pinned faces from google/fonts@$COMMIT"
  while read -r path digest; do
    [ -n "$path" ] || continue
    fetch "$path" "$digest" "$TMP"
  done <<< "$FACES"
  while read -r path digest; do
    [ -n "$path" ] || continue
    fetch "$path" "$digest" "$TMP"
  done <<< "$LICENSES"

  {
    echo "IBM Plex faces used to capture the Warsha visual baselines."
    echo "Source: the official OFL 1.1 files in google/fonts, commit $COMMIT."
    echo "Installed by scripts/ci/install-capture-fonts.sh; the app ships no font bytes."
    echo
    printf '%s\n' "$FACES"
  } >"$TMP/PROVENANCE.txt"

  as_root mkdir -p "$TARGET"
  as_root install -m 0644 "$TMP"/*.ttf "$TMP/OFL.txt" "$TMP/PROVENANCE.txt" "$TARGET/"
else
  echo "install-capture-fonts: all $FACE_COUNT faces already installed with the pinned digests"
fi

# The fontconfig CLI is what proves the families resolve. Playwright's --with-deps installs the
# library, and normally the binaries, but a host that has neither is a step failure, not a silent one.
if ! have fc-cache || ! have fc-match || ! have fc-list; then
  have apt-get || fail "fontconfig binaries are missing and this host has no apt-get to install them"
  echo "install-capture-fonts: installing the fontconfig CLI"
  as_root apt-get update -qq
  as_root apt-get install -y -qq fontconfig
fi

as_root fc-cache -f >/dev/null

# Family resolution is settled before a single screenshot is taken. The file has to be one of the
# pinned faces: a fc-match that answers with a substitute still names a plausible family, so the path
# is the only proof that the metrics are the ones the baselines were made with.
while read -r family; do
  [ -n "$family" ] || continue
  resolved=$(fc-match -f '%{family}|%{file}' "$family")
  resolved_family=${resolved%%|*}
  resolved_file=${resolved##*|}
  case "$resolved_file" in
    "$TARGET"/*) ;;
    *) fail "\"$family\" resolved to $resolved_file ($resolved_family), not the pinned faces in $TARGET" ;;
  esac
  case "$resolved_family" in
    *"$family"*) ;;
    *) fail "$resolved_file reports the family \"$resolved_family\", not \"$family\"" ;;
  esac
  echo "install-capture-fonts: \"$family\" -> $(basename "$resolved_file") as \"$resolved_family\""
done <<< "$FAMILIES"

# Every weight, not only the two regulars the families default to: the design sets 500 and 600.
# Listed once and matched as a string — piping fc-list into `grep -q` would make grep close the pipe on
# the first hit, and under pipefail the SIGPIPE status of fc-list would then fail a face that matched.
known=$(fc-list)
missing=0
while read -r path _; do
  [ -n "$path" ] || continue
  if ! grep -qF -- "$TARGET/$(basename "$path")" <<<"$known"; then
    echo "install-capture-fonts: $(basename "$path") is installed but fontconfig does not list it" >&2
    missing=$((missing + 1))
  fi
done <<< "$FACES"
[ "$missing" -eq 0 ] || fail "$missing face(s) are not known to fontconfig"

echo "install-capture-fonts: ok — $FACE_COUNT faces resolve from $TARGET"
