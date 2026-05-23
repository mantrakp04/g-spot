#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
command="${1:-}"

scrub_mac_metadata() {
  local p="$1"
  [[ -e "$p" ]] || return 0
  /usr/bin/xattr -d com.apple.FinderInfo "$p" >/dev/null 2>&1 || true
  /usr/bin/xattr -d 'com.apple.fileprovider.fpfs#P' "$p" >/dev/null 2>&1 || true
  /usr/bin/xattr -d com.apple.metadata:kMDItemWhereFroms "$p" >/dev/null 2>&1 || true
  /usr/bin/xattr -d com.apple.quarantine "$p" >/dev/null 2>&1 || true
  /bin/chflags nohidden "$p" >/dev/null 2>&1 || true
}

scrub_codesign_target() {
  local target="$1"
  [[ -e "$target" ]] || return 0

  scrub_mac_metadata "$target"

  local current
  current="$(dirname "$target")"
  local bundle=""

  while [[ -n "$current" && "$current" != "/" ]]; do
    scrub_mac_metadata "$current"
    if [[ "$current" == *.app ]]; then
      bundle="$current"
      break
    fi
    current="$(dirname "$current")"
  done

  if [[ -n "$bundle" && -d "$bundle" ]]; then
    while IFS= read -r -d '' p; do
      scrub_mac_metadata "$p"
    done < <(/usr/bin/find "$bundle" -print0 2>/dev/null)
  fi
}

run_build() {
  if [[ "$(uname -s)" == "Darwin" ]]; then
    export PATH="$script_dir/mac-release-bin:$PATH"
  fi

  exec bunx electrobun "$@"
}

run_codesign() {
  local target="${@: -1}"
  scrub_codesign_target "$target"
  exec /usr/bin/codesign "$@"
}

fail_download_check() {
  echo "$1" >&2
  exit 1
}

verify_download() {
  local required="${REQUIRE_MAC_DOWNLOAD_CHECKS:-false}"
  local mac_target="false"
  [[ "${ELECTROBUN_OS:-}" == "macos" || "$(uname -s)" == "Darwin" ]] && mac_target="true"

  [[ "$required" == "true" && "$mac_target" == "true" ]] || return 0
  [[ "$(uname -s)" == "Darwin" ]] || fail_download_check "Mac download checks must run on a Mac runner."
  [[ "${ELECTROBUN_NOTARIZE:-false}" == "true" ]] || fail_download_check 'Mac downloads will show "Move to Trash" unless the release is approved by Apple. Set the Apple release secrets in GitHub.'

  local artifact_dir="${ELECTROBUN_ARTIFACT_DIR:-}"
  [[ -n "$artifact_dir" && -d "$artifact_dir" ]] || fail_download_check "Could not find the desktop release artifacts."

  local dmg_path
  dmg_path="$(find "$artifact_dir" -maxdepth 1 -name '*.dmg' -print -quit)"
  [[ -n "$dmg_path" ]] || fail_download_check "No Mac installer found in $artifact_dir."

  local mount_dir
  mount_dir="$(mktemp -d /tmp/g-spot-dmg.XXXXXX)"

  cleanup() {
    hdiutil detach "$mount_dir" >/dev/null 2>&1 || true
    rm -rf "$mount_dir"
  }
  trap cleanup EXIT

  hdiutil verify "$dmg_path"
  hdiutil attach -nobrowse -readonly -mountpoint "$mount_dir" "$dmg_path" >/dev/null

  local app_path
  app_path="$(find "$mount_dir" -maxdepth 1 -name '*.app' -print -quit)"
  [[ -n "$app_path" ]] || fail_download_check "No Mac app was found inside $dmg_path."

  codesign --verify --deep --strict --verbose=2 "$app_path"
  spctl -a -vv -t exec "$app_path"
  spctl -a -vv -t open "$dmg_path"
}

case "$command" in
  build)
    shift
    run_build "$@"
    ;;
  codesign)
    shift
    run_codesign "$@"
    ;;
  verify-download)
    verify_download
    ;;
  *)
    echo "Usage: $0 {build|codesign|verify-download}" >&2
    exit 2
    ;;
esac
