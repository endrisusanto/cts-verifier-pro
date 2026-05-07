#!/bin/bash

# CTS Verifier Installer - Auto Build Script
# Targets: DEB and RPM

# Exit on error
set -e

echo "------------------------------------------------"
echo "🚀 Starting Production Build for Linux..."
echo "------------------------------------------------"

# Ensure dependencies are installed (optional check)
if ! command -v npm &> /dev/null; then
    echo "❌ Error: npm is not installed."
    exit 1
fi

# 1. Clean previous builds
echo "🧹 Cleaning previous builds..."
rm -rf src-tauri/target/release/bundle/deb
rm -rf src-tauri/target/release/bundle/rpm
rm -rf releases/
mkdir -p releases

# 2. Run Tauri Build
echo "📦 Running Tauri Build (this may take a while)..."
# Force cross-platform bundling to include both deb and rpm
npm run tauri build -- --bundles deb,rpm

# 3. Collect Artifacts
echo "📂 Collecting installers into /releases folder..."

# Search and copy .deb
DEB_FILE=$(find src-tauri/target/release/bundle/deb -name "*.deb" | head -n 1)
if [ -f "$DEB_FILE" ]; then
    cp "$DEB_FILE" releases/
    echo "✅ DEB Package: $(basename "$DEB_FILE")"
else
    echo "⚠️  Warning: DEB package not found."
fi

# Search and copy .rpm
RPM_FILE=$(find src-tauri/target/release/bundle/rpm -name "*.rpm" | head -n 1)
if [ -f "$RPM_FILE" ]; then
    cp "$RPM_FILE" releases/
    echo "✅ RPM Package: $(basename "$RPM_FILE")"
else
    echo "⚠️  Warning: RPM package not found."
fi

echo "------------------------------------------------"
echo "🎉 Build Completed! Check the 'releases' folder."
echo "------------------------------------------------"
