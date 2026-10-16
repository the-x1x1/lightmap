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
  -framework AppKit -framework WebKit -framework CryptoKit -framework Security 2>&1 | annotate

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

# 4. Sign. With a Developer ID (MAC_SIGN_IDENTITY, e.g. "Developer ID Application: Name (TEAMID)",
#    in a keychain the job unlocked) every executable inside is signed with the hardened runtime
#    and a secure timestamp, innermost first, and the app is notarised and stapled below, so
#    it opens with no warning. Without one it is signed ad hoc: Apple Silicon runs no unsigned
#    code, and Gatekeeper asks once on the first open (see apps/desktop/README.md).
if [ -n "${MAC_SIGN_IDENTITY:-}" ]; then
  ents="$here/entitlements.plist"
  sign() { codesign --force --timestamp --options runtime --entitlements "$ents" --sign "$MAC_SIGN_IDENTITY" "$@"; }
  while IFS= read -r -d '' f; do sign "$f"; done < <(
    find "$app/Contents/Resources" -type f \( -name '*.node' -o -name '*.dylib' -o -name '*.so' \) -print0
  )
  sign "$app/Contents/Resources/runtime/node"
  sign "$app/Contents/MacOS/LightMap"
  sign "$app"
  codesign --verify --strict --deep --verbose=2 "$app"
else
  codesign --force --sign - --timestamp=none "$app"
  codesign --verify --verbose=2 "$app"
fi

# Notarise (Apple's malware check) when the credentials are there: APPLE_ID, APPLE_TEAM_ID and an
# app-specific password in APPLE_APP_PASSWORD. The ticket is stapled to the app, so it opens
# offline too.
notarise() {
  [ -n "${MAC_SIGN_IDENTITY:-}" ] && [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ] && [ -n "${APPLE_APP_PASSWORD:-}" ]
}
if notarise; then
  ditto -c -k --keepParent "$app" "$out/notarise.zip"
  xcrun notarytool submit "$out/notarise.zip" --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" \
    --password "$APPLE_APP_PASSWORD" --wait
  rm -f "$out/notarise.zip"
  xcrun stapler staple "$app"
  spctl --assess --type execute --verbose=2 "$app"
fi

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

if notarise; then
  codesign --force --timestamp --sign "$MAC_SIGN_IDENTITY" "$dmg"
  xcrun notarytool submit "$dmg" --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" \
    --password "$APPLE_APP_PASSWORD" --wait
  xcrun stapler staple "$dmg"
fi

for f in "$zip" "$dmg"; do
  printf '%s  %s' "$(shasum -a 256 "$f" | cut -d' ' -f1)" "$(basename "$f")" > "$f.sha256"
  cat "$f.sha256"; echo
done
du -sh "$app" "$zip" "$dmg"
