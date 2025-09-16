#!/usr/bin/env bash
# Minimal packaging script for webOS app (creates ipk-like .wgt package folder)
# Usage: ./package-webos.sh
set -e
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$ROOT_DIR/dist"
PKG_NAME="watchwithfriends"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR/$PKG_NAME"
# Copy files
rsync -av --exclude=node_modules --exclude=.git "$ROOT_DIR/" "$OUT_DIR/$PKG_NAME/"
# Create a simple zip as a placeholder for the wgt package
cd "$OUT_DIR"
zip -r "$PKG_NAME.wgt" "$PKG_NAME" >/dev/null
echo "Packaged $OUT_DIR/$PKG_NAME.wgt"

echo "Note: For real webOS packaging/signing, use webOS CLI (ares-package / ares-install) with a proper manifest and signing keys."
