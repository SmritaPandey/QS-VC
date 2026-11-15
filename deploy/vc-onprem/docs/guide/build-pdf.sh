#!/usr/bin/env bash
# Render the customer server setup guide to the PDF served at qsvcmeet.com/guides/QS-VC-Intranet-Setup.pdf.
#   bash deploy/vc-onprem/docs/guide/build-pdf.sh
# Needs Google Chrome or Chromium (headless printing).
set -euo pipefail
here=$(cd -- "$(dirname -- "$0")" && pwd)
repo=$(cd -- "$here/../../../.." && pwd)
chrome=${CHROME:-}
for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" google-chrome chromium chromium-browser; do
  [[ -n $chrome ]] && break
  if [[ -x $c ]] || command -v "$c" >/dev/null 2>&1; then chrome=$c; fi
done
[[ -n $chrome ]] || { echo 'Install Google Chrome or set CHROME=/path/to/chrome' >&2; exit 2; }
out="$repo/frontend/web/public/guides/QS-VC-Intranet-Setup.pdf"
"$chrome" --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf="$out" "file://$here/QS-VC-Server-Setup-Guide.html" 2>/dev/null
cp "$out" "$repo/docs/QS-VC-Intranet-Setup.pdf"
echo "Wrote $out"
