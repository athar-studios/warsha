#!/usr/bin/env bash
# generate-android-keystore.sh — Warsha Android release signing keystore bootstrap.
#
# Creates (once) a private release keystore OUTSIDE the git repository at:
#   $HOME/.warsha/signing/warsha-release.jks   (POSIX)
#   $USERPROFILE/.warsha/signing/warsha-release.jks  (Windows Git Bash)
# together with $HOME/.warsha/signing/keystore.properties consumed by
# apps/mobile/android/app/build.gradle (signingConfigs.release).
#
# Idempotent: if the keystore already exists it is reused and only its path +
# SHA-256 certificate fingerprint are printed. No keystore or .properties file
# is ever written inside a repository working tree.
#
# Requirements: bash (Git Bash on Windows) or POSIX sh environment, keytool on
# PATH or under $JAVA_HOME/bin.
set -eu

# ---------------------------------------------------------------------------
# Resolve the signing directory (never inside the repo).
# ---------------------------------------------------------------------------
if [ -n "${HOME:-}" ] && [ -d "${HOME}" ]; then
  BASE_DIR="${HOME}"
elif [ -n "${USERPROFILE:-}" ] && [ -d "${USERPROFILE}" ]; then
  # Git Bash sometimes leaves HOME unset; fall back to the Windows profile.
  BASE_DIR="${USERPROFILE}"
else
  echo "ERROR: neither HOME nor USERPROFILE is set; cannot locate a private directory." >&2
  exit 1
fi

SIGNING_DIR="${WARSHA_SIGNING_DIR:-${BASE_DIR}/.warsha/signing}"
KEYSTORE_PATH="${SIGNING_DIR}/warsha-release.jks"
PROPERTIES_PATH="${SIGNING_DIR}/keystore.properties"

# Guard: refuse to write into any git working tree.
repo_root="$(git -C "$(pwd)" rev-parse --show-toplevel 2>/dev/null || true)"
case "${SIGNING_DIR}" in
  "${repo_root}"/*|"${repo_root}")
    echo "ERROR: refusing to write signing material inside the git repository (${repo_root})." >&2
    exit 1
    ;;
esac

# ---------------------------------------------------------------------------
# Locate keytool: WARSHA_KEYTOOL > $JAVA_HOME/bin > PATH.
# ---------------------------------------------------------------------------
find_keytool() {
  if [ -n "${WARSHA_KEYTOOL:-}" ] && [ -x "${WARSHA_KEYTOOL}" ]; then
    printf '%s\n' "${WARSHA_KEYTOOL}"
    return 0
  fi
  if [ -n "${JAVA_HOME:-}" ]; then
    for candidate in "${JAVA_HOME}/bin/keytool.exe" "${JAVA_HOME}/bin/keytool"; do
      if [ -x "${candidate}" ]; then
        printf '%s\n' "${candidate}"
        return 0
      fi
    done
  fi
  if command -v keytool.exe >/dev/null 2>&1; then
    command -v keytool.exe
    return 0
  fi
  if command -v keytool >/dev/null 2>&1; then
    command -v keytool
    return 0
  fi
  echo "ERROR: keytool not found on PATH or under JAVA_HOME (${JAVA_HOME:-unset})." >&2
  echo "       Set JAVA_HOME (e.g. the Android Studio JBR) or WARSHA_KEYTOOL." >&2
  return 1
}

KEYTOOL="$(find_keytool)"

# ---------------------------------------------------------------------------
# Random 24-char alphanumeric password (no shell/properties metacharacters).
# ---------------------------------------------------------------------------
gen_password() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 64 | tr -cd 'A-Za-z0-9' | head -c 24
  else
    tr -cd 'A-Za-z0-9' < /dev/urandom | head -c 24
  fi
}

# Emit a path Gradle/Java can open: on Git Bash (MSYS) convert POSIX-style
# paths to C:/... form with cygpath; elsewhere keep the path as-is.
native_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -m "$1"
  else
    printf '%s\n' "$1"
  fi
}

DistinguishedName='CN=Warsha Remote, OU=Engineering, O=Warsha, L=Riyadh, C=SA'
KEY_ALIAS="warsha-release"
VALIDITY_DAYS=10000
KEY_SIZE=4096

print_fingerprint() {
  # Prints only the SHA-256 certificate fingerprint line — never the password.
  WARSHA_KS_PASS_ENV="$(read_store_password)" "${KEYTOOL}" -list -v \
    -keystore "${KEYSTORE_PATH}" -storetype PKCS12 -storepass:env WARSHA_KS_PASS_ENV \
    2>/dev/null | grep -E 'SHA256?:' | head -n 1 || true
}

read_store_password() {
  if [ -f "${PROPERTIES_PATH}" ]; then
    # shellcheck disable=SC2002
    cat "${PROPERTIES_PATH}" | tr -d '\r' | sed -n 's/^storePassword=//p'
  else
    echo "ERROR: ${PROPERTIES_PATH} missing while keystore exists." >&2
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
mkdir -p "${SIGNING_DIR}"
chmod 700 "${SIGNING_DIR}" 2>/dev/null || true

if [ -f "${KEYSTORE_PATH}" ] && [ -f "${PROPERTIES_PATH}" ]; then
  chmod 600 "${PROPERTIES_PATH}" 2>/dev/null || true
  echo "Keystore already exists — reusing it (nothing regenerated)."
  echo "Keystore path: ${KEYSTORE_PATH}"
  echo "Properties:    ${PROPERTIES_PATH}"
  echo "Fingerprint:   $(print_fingerprint)"
  exit 0
fi

if [ -f "${KEYSTORE_PATH}" ] && [ ! -f "${PROPERTIES_PATH}" ]; then
  echo "ERROR: ${KEYSTORE_PATH} exists but ${PROPERTIES_PATH} is missing;" >&2
  echo "       the store password cannot be recovered. Restore the properties" >&2
  echo "       file from your secret backup or rotate to a new keystore manually." >&2
  exit 1
fi

KS_PASSPHRASE="$(gen_password)"
if [ "${#KS_PASSPHRASE}" -lt 24 ]; then
  echo "ERROR: failed to generate a 24-character password." >&2
  exit 1
fi

umask 077
WARSHA_KS_GEN_PASS_ENV="${KS_PASSPHRASE}" "${KEYTOOL}" -genkeypair \
  -keystore "${KEYSTORE_PATH}" \
  -storetype PKCS12 \
  -alias "${KEY_ALIAS}" \
  -keyalg RSA \
  -keysize "${KEY_SIZE}" \
  -validity "${VALIDITY_DAYS}" \
  -dname "${DistinguishedName}" \
  -storepass:env WARSHA_KS_GEN_PASS_ENV \
  -keypass:env WARSHA_KS_GEN_PASS_ENV

cat > "${PROPERTIES_PATH}" <<EOF
storeFile=$(native_path "${KEYSTORE_PATH}")
storePassword=${KS_PASSPHRASE}
keyAlias=${KEY_ALIAS}
keyPassword=${KS_PASSPHRASE}
EOF
chmod 600 "${PROPERTIES_PATH}" 2>/dev/null || true
unset KS_PASSPHRASE WARSHA_KS_GEN_PASS_ENV

echo "Generated new Warsha release keystore (4096-bit RSA, PKCS12, ${VALIDITY_DAYS} days)."
echo "Keystore path: ${KEYSTORE_PATH}"
echo "Properties:    ${PROPERTIES_PATH}  (chmod 600 — keep out of git, back it up!)"
echo "Fingerprint:   $(print_fingerprint)"
