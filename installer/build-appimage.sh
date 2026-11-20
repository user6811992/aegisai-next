#!/bin/bash
# Build Linux AppImage for AegisAI (next)
# Requires: appimagetool, Node.js 22+

set -e
APP_NAME="AegisAI (next)"
VERSION="1.0.0"
BUILD_DIR="build/appimage"
APPDIR="$BUILD_DIR/AegisAI.AppDir"

echo "Building AegisAI (next) AppImage..."

# Clean
rm -rf "$BUILD_DIR"
mkdir -p "$APPDIR/usr/bin" "$APPDIR/usr/share/applications" "$APPDIR/usr/share/icons/hicolor/256x256/apps"

# Stage app
cp -r . "$APPDIR/usr/bin/aegisai" 2>/dev/null || true
cd "$APPDIR/usr/bin/aegisai"
rm -rf node_modules .git data scripts
npm install --omit=dev
npm run build
cd ../../../..

# Create .desktop entry
cat > "$APPDIR/usr/share/applications/aegisai.desktop" <<EOF
[Desktop Entry]
Name=AegisAI (next)
Exec=aegisai
Icon=aegisai
Type=Application
Categories=Development;Utility;
EOF
cp "$APPDIR/usr/share/applications/aegisai.desktop" "$APPDIR/"

# Create AppRun
cat > "$APPDIR/AppRun" <<'EOF'
#!/bin/bash
cd "$(dirname "$0")/usr/bin/aegisai"
exec node server.js
EOF
chmod +x "$APPDIR/AppRun"

# Create icon (placeholder)
cp "public/icon.svg" "$APPDIR/usr/share/icons/hicolor/256x256/apps/aegisai.svg" 2>/dev/null || true
cp "public/icon.svg" "$APPDIR/aegisai.svg" 2>/dev/null || true

# Build AppImage
ARCH=x86_64 appimagetool "$APPDIR" "AegisAI-Next-${VERSION}-x86_64.AppImage"

echo "Created: AegisAI-Next-${VERSION}-x86_64.AppImage"
