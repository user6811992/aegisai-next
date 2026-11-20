#!/bin/bash
# Build macOS .dmg for AegisAI (next)
# Requires: create-dmg (brew install create-dmg), Node.js 22+

set -e
APP_NAME="AegisAI (next)"
VERSION="1.0.0"
BUILD_DIR="build/macos"
DMG_NAME="AegisAI-Next-${VERSION}.dmg"

echo "Building AegisAI (next) macOS .dmg..."

# Clean
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

# Stage app
cp -r . "$BUILD_DIR/AegisAI (next)" 2>/dev/null || true
cd "$BUILD_DIR/AegisAI (next)"
rm -rf node_modules .git data scripts
npm install --omit=dev
npm run build
cd ../..

# Create .dmg
create-dmg \
  --volname "AegisAI (next)" \
  --window-pos 200 120 \
  --window-size 600 400 \
  --icon-size 100 \
  --app-drop-link 450 185 \
  "$DMG_NAME" \
  "$BUILD_DIR"

echo "Created: $DMG_NAME"
