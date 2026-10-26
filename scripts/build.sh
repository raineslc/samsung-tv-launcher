#!/bin/sh
# Packages src/ into dist/arn0-launcher.wgt (unsigned; Apps2Samsung signs it on install).
set -eu
cd "$(dirname "$0")/.."

[ -f src/icon.png ] || node scripts/make-icon.mjs
# index.html always loads this; an absent file would only be a console error, but there is no
# reason to ship one. Gitignored, so creating it here cannot dirty the tree.
[ -f src/js/config.local.js ] || echo '/* No local overrides. See config.local.example.js. */' > src/js/config.local.js
node scripts/build-marks.mjs

mkdir -p dist
rm -f dist/arn0-launcher.wgt
if command -v zip >/dev/null 2>&1; then
(cd src && zip -q -r -X ../dist/arn0-launcher.wgt . -x '*.DS_Store' -x '.*' -x 'img/marks/*' \
  -x 'img/easter-egg/*.jpg' -x 'img/easter-egg/runner.png' -x 'img/easter-egg/obstacle.png' \
  -x 'img/easter-egg/obstacle-face.png')
else
# Git Bash on Windows has no zip; Python's zipfile writes the same archive with forward slashes.
PY=$(command -v python3 || command -v python)
"$PY" - <<'EOF'
import fnmatch, os, zipfile
skip = ['*.DS_Store', 'img/marks/*', 'img/easter-egg/*.jpg', 'img/easter-egg/runner.png',
        'img/easter-egg/obstacle.png', 'img/easter-egg/obstacle-face.png']
with zipfile.ZipFile('dist/arn0-launcher.wgt', 'w', zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk('src'):
        dirs[:] = sorted(d for d in dirs if not d.startswith('.'))
        for f in sorted(files):
            rel = os.path.relpath(os.path.join(root, f), 'src').replace(os.sep, '/')
            if f.startswith('.') or any(fnmatch.fnmatch(rel, p) for p in skip):
                continue
            z.write(os.path.join(root, f), rel)
EOF
fi

echo "Built dist/arn0-launcher.wgt"
unzip -l dist/arn0-launcher.wgt
