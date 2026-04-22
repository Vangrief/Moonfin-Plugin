#!/usr/bin/env bash
# Build script for Moonfin Jellyfin server plugin (backend-only fork)
# Creates a release ZIP with proper structure for plugin manifest
# Works on Linux, macOS, and Windows (Git Bash/WSL)

set -e

VERSION="${1:-1.8.2.0}"
TARGET_ABI="${2:-10.10.0}"
BUILD_TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Get repo root (where this script lives)
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"

echo "Building Moonfin v${VERSION} for Jellyfin ${TARGET_ABI}..."
echo "Build Time: ${BUILD_TIMESTAMP}"

# Build the .NET plugin
echo ""
echo "--- Building server plugin ---"
dotnet build "$BACKEND_DIR/Moonfin.Server.csproj" -c Release

# Create release directory
RELEASE_DIR="$ROOT_DIR/release"
rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"

# Copy DLL to release folder
cp "$BACKEND_DIR/bin/Release/net8.0/Moonfin.Server.dll" "$RELEASE_DIR/"

# Generate meta.json for plugin discovery
PLUGIN_GUID="8c5d0e91-4f2a-4b6d-9e3f-1a7c8d9e0f2b"
TIMESTAMP_ISO=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
cat > "$RELEASE_DIR/meta.json" <<EOF
{
  "category": "General",
  "changelog": "",
  "description": "Moonfin server plugin (backend-only): Jellyseerr SSO proxy with admin-configured per-user credentials, settings sync, MDBList and TMDB ratings. No web UI injection.",
  "guid": "${PLUGIN_GUID}",
  "name": "Moonfin",
  "overview": "Server-side APIs for Jellyseerr SSO, settings sync, and ratings",
  "owner": "RadicalMuffinMan",
  "targetAbi": "${TARGET_ABI}.0",
  "timestamp": "${TIMESTAMP_ISO}",
  "version": "${VERSION}",
  "status": "Active",
  "autoUpdate": true,
  "assemblies": ["Moonfin.Server.dll"]
}
EOF

# Create the ZIP file
ZIP_NAME="Moonfin.Server-${VERSION}.zip"
rm -f "$ROOT_DIR/$ZIP_NAME"
cd "$RELEASE_DIR"
zip -r "$ROOT_DIR/$ZIP_NAME" .
cd "$ROOT_DIR"

# Calculate MD5 checksum (cross-platform)
if command -v md5sum &> /dev/null; then
    CHECKSUM=$(md5sum "$ZIP_NAME" | awk '{print toupper($1)}')
elif command -v md5 &> /dev/null; then
    CHECKSUM=$(md5 -q "$ZIP_NAME" | tr '[:lower:]' '[:upper:]')
elif command -v certutil &> /dev/null; then
    # Windows fallback (Git Bash)
    CHECKSUM=$(certutil -hashfile "$ZIP_NAME" MD5 2>/dev/null | sed -n '2p' | tr -d ' ' | tr '[:lower:]' '[:upper:]')
else
    CHECKSUM="UNABLE_TO_CALCULATE"
fi

# Update manifest.json
MANIFEST_FILE="$ROOT_DIR/manifest.json"
if [ -f "$MANIFEST_FILE" ]; then
    TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S")

    if command -v jq &> /dev/null; then
        jq --arg ver "$VERSION" \
           --arg abi "${TARGET_ABI}.0" \
           --arg sum "$CHECKSUM" \
           --arg time "$TIMESTAMP" \
           '.[0].versions[0].version = $ver |
            .[0].versions[0].targetAbi = $abi |
            .[0].versions[0].checksum = $sum |
            .[0].versions[0].timestamp = $time' \
           "$MANIFEST_FILE" > "${MANIFEST_FILE}.tmp" && mv "${MANIFEST_FILE}.tmp" "$MANIFEST_FILE"
        echo "Updated manifest.json with new checksum and version"
    else
        sed -i.bak -E "s/\"version\": \"[^\"]+\"/\"version\": \"$VERSION\"/" "$MANIFEST_FILE"
        sed -i.bak -E "s/\"checksum\": \"[^\"]+\"/\"checksum\": \"$CHECKSUM\"/" "$MANIFEST_FILE"
        sed -i.bak -E "s/\"timestamp\": \"[^\"]+\"/\"timestamp\": \"$TIMESTAMP\"/" "$MANIFEST_FILE"
        rm -f "${MANIFEST_FILE}.bak"
        echo "Updated manifest.json with new checksum and version (using sed)"
    fi
fi

# Cleanup
rm -rf "$RELEASE_DIR"

echo ""
echo "========================================="
echo "Build complete!"
echo "Build Time: ${BUILD_TIMESTAMP}"
echo "========================================="
echo "ZIP file: $ZIP_NAME"
echo "MD5 Checksum: $CHECKSUM"
echo "Manifest updated: manifest.json"
echo "========================================="
echo ""
echo "Done!"
