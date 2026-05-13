#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

PLATFORM="${1:-auto}"
RELEASES_DIR="$ROOT_DIR/releases"
RESOURCES_SRC_DIR="$ROOT_DIR/src-tauri/apks"
RESOURCES_OUT_DIR="$RELEASES_DIR/resources"
RESOURCES_ZIP="$RELEASES_DIR/cts-verifier-resources.zip"

log() {
  printf '%s\n' "$1"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log "❌ Missing required command: $1"
    exit 1
  fi
}

create_zip() {
  local zip_name="$1"
  local source_dir="$2"

  if command -v zip >/dev/null 2>&1; then
    zip -qr "$zip_name" "$source_dir"
    return
  fi

  if command -v powershell.exe >/dev/null 2>&1; then
    powershell.exe -NoProfile -Command \
      "Compress-Archive -Path '$source_dir' -DestinationPath '$zip_name' -Force" >/dev/null
    return
  fi

  log "❌ Neither 'zip' nor 'powershell.exe' is available to create $zip_name"
  exit 1
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

prepare_resources() {
  if [[ ! -d "$RESOURCES_SRC_DIR" ]]; then
    log "⚠️  Resource source folder not found: $RESOURCES_SRC_DIR"
    return
  fi

  rm -rf "$RESOURCES_OUT_DIR" "$RESOURCES_ZIP"
  mkdir -p "$RESOURCES_OUT_DIR"
  cp -a "$RESOURCES_SRC_DIR"/. "$RESOURCES_OUT_DIR"/

  cat > "$RESOURCES_OUT_DIR/README.txt" <<'EOF'
CTS Verifier Pro external resources

Keep this folder beside the application binary as "resources", or set:
CTS_VERIFIER_RESOURCE_DIR=/path/to/resources

Expected structure:
resources/ApkTest/
resources/Normal/13/
resources/Normal/14/
resources/Normal/15/
resources/Normal/16/
EOF

  (
    cd "$RELEASES_DIR"
    create_zip "$(basename "$RESOURCES_ZIP")" resources
  )

  log "✅ External resources folder: $RESOURCES_OUT_DIR"
  log "✅ External resources zip: $RESOURCES_ZIP"
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

log "📦 Preparing external resources..."
prepare_resources

log "------------------------------------------------"
log "🎉 Build completed. Output available in: $RELEASES_DIR"
log "------------------------------------------------"
