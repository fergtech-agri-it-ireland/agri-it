#!/usr/bin/env bash
# Build the third-party review pack: agri-it-review-pack.zip
#   README.md, FEEDBACK-TEMPLATE.csv, agri-it-demo.html (the demo farm), screens/ (gallery + JPEGs)
# Run from the repo root after `npm install`. Needs python3 with playwright and chromium.
set -euo pipefail

npm run build:demo
npm run build:phone

PORT=4331
python3 -m http.server "$PORT" --directory dist-demo >/dev/null 2>&1 &
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null || true' EXIT
sleep 2

python3 scripts/review_screens.py "http://localhost:$PORT/" dist-phone/index.html docs/review/screens

PACK=review-pack
rm -rf "$PACK" agri-it-review-pack.zip
mkdir -p "$PACK/screens"
cp docs/review/README.md docs/review/FEEDBACK-TEMPLATE.csv "$PACK/"
cp dist-demo/index.html "$PACK/agri-it-demo.html"
cp docs/review/screens/*.jpg docs/review/screens/index.html "$PACK/screens/"
(cd "$PACK" && zip -qr ../agri-it-review-pack.zip .)
rm -rf "$PACK"
echo "Wrote agri-it-review-pack.zip"
