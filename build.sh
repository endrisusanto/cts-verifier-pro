#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

PLATFORM="${1:-auto}"
RELEASES_DIR="$ROOT_DIR/releases"

log() {
  printf '%s\n' "$1"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log "❌ Missing required command: $1"
    exit 1
  fi
}

detect_platform() {
  case "$(uname -s)" in
    Linux*) echo "linux" ;;
    MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
    *) echo "unsupported" ;;
  esac
}

resolve_bundles() {
  case "$1" in
    linux) echo "deb,rpm" ;;
    windows) echo "nsis" ;;
    *)
      log "❌ Unsupported platform: $1"
      log "   Use: ./build.sh [linux|windows|auto]"
      exit 1
      ;;
  esac
}

copy_if_found() {
  local search_dir="$1"
  local filename_pattern="$2"
  local label="$3"
  local found_file
  found_file="$(find "$search_dir" -name "$filename_pattern" 2>/dev/null | head -n 1 || true)"
  if [[ -n "$found_file" && -f "$found_file" ]]; then
    cp "$found_file" "$RELEASES_DIR/"
    log "✅ ${label}: $(basename "$found_file")"
  else
    log "⚠️  ${label} not found."
  fi
}

CURRENT_PLATFORM="$PLATFORM"
if [[ "$CURRENT_PLATFORM" == "auto" ]]; then
  CURRENT_PLATFORM="$(detect_platform)"
fi

if [[ "$CURRENT_PLATFORM" == "unsupported" ]]; then
  log "❌ Unsupported host platform for build.sh."
  exit 1
fi

BUNDLES="$(resolve_bundles "$CURRENT_PLATFORM")"

require_cmd npm

log "------------------------------------------------"
log "🚀 Starting production build for ${CURRENT_PLATFORM}..."
log "📦 Requested bundles: ${BUNDLES}"
log "------------------------------------------------"

rm -rf "$RELEASES_DIR"
mkdir -p "$RELEASES_DIR"

if [[ "$CURRENT_PLATFORM" == "linux" ]]; then
  rm -rf src-tauri/target/release/bundle/deb src-tauri/target/release/bundle/rpm
else
  rm -rf src-tauri/target/release/bundle/nsis src-tauri/target/release/bundle/msi
fi

npm install
npm run tauri build -- --bundles "$BUNDLES"

log "📂 Collecting installer artifacts..."
if [[ "$CURRENT_PLATFORM" == "linux" ]]; then
  copy_if_found "src-tauri/target/release/bundle/deb" "*.deb" "DEB package"
  copy_if_found "src-tauri/target/release/bundle/rpm" "*.rpm" "RPM package"
else
  copy_if_found "src-tauri/target/release/bundle/nsis" "*.exe" "Windows EXE installer"
  copy_if_found "src-tauri/target/release/bundle/msi" "*.msi" "Windows MSI installer"
fi

log "ℹ️  External APK resources are not bundled or packaged by this script."
log "ℹ️  Copy the resource folder manually after installation and/or set CTS_VERIFIER_RESOURCE_DIR."

log "------------------------------------------------"
log "🎉 Build completed. Output available in: $RELEASES_DIR"
log "------------------------------------------------"
