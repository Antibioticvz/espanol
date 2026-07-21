#!/usr/bin/env bash
# Rebuilds every rendered/derived branding asset from the two master SVGs.
# macOS only. Requires: qlmanage, sips, iconutil (all system tools) and node
# (for the dependency-free alpha-stripping helper).
#
# Pipeline:
#   1. Rasterize each master SVG to a 1024x1024 PNG via QuickLook
#      (`qlmanage -t -s 1024`) - there is no direct SVG-to-PNG CLI rasterizer
#      on stock macOS, but QuickLook's thumbnail generator renders SVG
#      faithfully (including strokes/curves) and this is scriptable.
#   2. Combine: build a 7-size .iconset from the 1024 PNG with `sips -z`,
#      then `iconutil -c icns` it into combine-icon.icns.
#   3. Audio Learner: the App Store rejects icons with an alpha channel, but
#      qlmanage always emits RGBA and `sips` cannot drop the channel, so
#      strip-alpha.mjs (zlib-only, zero deps) rewrites the PNG as plain RGB.
set -euo pipefail
cd "$(dirname "$0")/.."   # shared/branding/

echo "== 1/4 rasterizing SVGs to 1024 PNG =="
qlmanage -t -s 1024 -o . combine-icon.svg >/dev/null
mv -f combine-icon.svg.png combine-icon-1024.png

qlmanage -t -s 1024 -o . audiolearner-icon.svg >/dev/null
mv -f audiolearner-icon.svg.png audiolearner-icon-1024-rgba-tmp.png

echo "== 2/4 stripping alpha for the App Store PNG =="
node tools/strip-alpha.mjs audiolearner-icon-1024-rgba-tmp.png audiolearner-appicon-1024.png
rm -f audiolearner-icon-1024-rgba-tmp.png

echo "== 3/4 building combine.iconset =="
rm -rf combine.iconset
mkdir combine.iconset
src=combine-icon-1024.png
sips -z 16 16     "$src" --out combine.iconset/icon_16x16.png       >/dev/null
sips -z 32 32     "$src" --out combine.iconset/icon_16x16@2x.png    >/dev/null
sips -z 32 32     "$src" --out combine.iconset/icon_32x32.png       >/dev/null
sips -z 64 64     "$src" --out combine.iconset/icon_32x32@2x.png    >/dev/null
sips -z 128 128   "$src" --out combine.iconset/icon_128x128.png     >/dev/null
sips -z 256 256   "$src" --out combine.iconset/icon_128x128@2x.png  >/dev/null
sips -z 256 256   "$src" --out combine.iconset/icon_256x256.png     >/dev/null
sips -z 512 512   "$src" --out combine.iconset/icon_256x256@2x.png  >/dev/null
sips -z 512 512   "$src" --out combine.iconset/icon_512x512.png     >/dev/null
cp "$src"                combine.iconset/icon_512x512@2x.png

echo "== 4/4 packing .icns =="
iconutil -c icns combine.iconset -o combine-icon.icns

echo "== verify =="
echo "combine-icon.icns:      $(du -h combine-icon.icns | cut -f1)"
sips -g hasAlpha -g pixelWidth -g pixelHeight audiolearner-appicon-1024.png
echo "done."
