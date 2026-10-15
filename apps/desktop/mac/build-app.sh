#!/usr/bin/env bash
# Build LightMap.app, its update zip and its disk image, on a Mac (CI: macos-latest).
#
#   bash apps/desktop/mac/build-app.sh <version>
#
# Run after `pnpm install --config.node-linker=hoisted` and
# `LIGHTMAP_DESKTOP=1 pnpm --filter @lightmap/web build`. Writes apps/desktop/mac/out/:
#   LightMap.app
#   LightMap-<version>-mac-<arch>.zip (+ .sha256)   what installed copies download to update
#   LightMap-<version>-mac-<arch>.dmg (+ .sha256)   what a person downloads to install
set -euo pipefail

version="${1:?usage: build-app.sh <version>}"
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
out="$here/out"
app="$out/LightMap.app"
case "$(uname -m)" in
  arm64) arch=arm64; triple=arm64-apple-macos12 ;;
  x86_64) arch=x64; triple=x86_64-apple-macos12 ;;
  *) echo "unsupported machine $(uname -m)" >&2; exit 2 ;;
esac

# In GitHub Actions an ::error:: line becomes an annotation, readable without the log.
annotate() {
  if [ -n "${GITHUB_ACTIONS:-}" ]; then
    sed -E 's#^(/[^:]+):([0-9]+):([0-9]+): error: (.*)$#::error file=\1,line=\2,col=\3::\4#'
  else
    cat
  fi
}

rm -rf "$out"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"

# 1. The server and the Node runtime, into Contents/Resources (the shared staging script).
node "$repo/apps/desktop/scripts/stage.mjs" --target mac --node "$(command -v node)" \
  --out "$app/Contents/Resources"
cp "$here/parent-watch.cjs" "$app/Contents/Resources/runtime/parent-watch.cjs"

# 2. The shell.
swiftc -O -swift-version 5 -target "$triple" \
  -o "$app/Contents/MacOS/LightMap" \
  "$here"/Sources/*.swift \
  -framework AppKit -framework WebKit -framework CryptoKit 2>&1 | annotate

# 3. Info.plist and the icon.
sed "s/__VERSION__/$version/g" "$here/Info.plist" > "$app/Contents/Info.plist"
plutil -lint "$app/Contents/Info.plist"
iconset="$out/AppIcon.iconset"
mkdir -p "$iconset"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$here/AppIcon-1024.png" --out "$iconset/icon_${size}x${size}.png" > /dev/null
  double=$((size * 2))
  sips -z "$double" "$double" "$here/AppIcon-1024.png" --out "$iconset/icon_${size}x${size}@2x.png" > /dev/null
done
iconutil -c icns "$iconset" -o "$app/Contents/Resources/AppIcon.icns"
rm -rf "$iconset"

# 4. Sign ad hoc. Apple Silicon runs no unsigned code; an ad-hoc signature is not a Developer ID,
#    so Gatekeeper asks once on the first open (see apps/desktop/README.md). The bundled node
#    keeps its own signature from the Node.js project.
codesign --force --sign - --timestamp=none "$app"
codesign --verify --verbose=2 "$app"

# 5. The update zip and the disk image (with an Applications shortcut to drag onto).
zip="$out/LightMap-$version-mac-$arch.zip"
dmg="$out/LightMap-$version-mac-$arch.dmg"
ditto -c -k --sequesterRsrc --keepParent "$app" "$zip"
dmgroot="$out/dmg"
mkdir -p "$dmgroot"
ditto "$app" "$dmgroot/LightMap.app"
ln -s /Applications "$dmgroot/Applications"
hdiutil create -volname "LightMap $version" -srcfolder "$dmgroot" -ov -format UDZO "$dmg" > /dev/null
rm -rf "$dmgroot"

for f in "$zip" "$dmg"; do
  printf '%s  %s' "$(shasum -a 256 "$f" | cut -d' ' -f1)" "$(basename "$f")" > "$f.sha256"
  cat "$f.sha256"; echo
done
du -sh "$app" "$zip" "$dmg"
