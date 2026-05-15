#!/usr/bin/env bash
# Wrapper that runs `electrobun` with a `codesign` shim on PATH (macOS
# only). The shim strips com.apple.provenance xattrs before invoking
# the real codesign, so ad-hoc signing (ELECTROBUN_DEVELOPER_ID="-")
# succeeds on bun-compiled binaries.
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"

if [[ "$(uname -s)" == "Darwin" ]]; then
  export PATH="$script_dir/codesign-shim:$PATH"
fi

exec bunx electrobun "$@"
