'use strict';
// electron-builder afterPack hook (runs before the ZIP is written).
//  - macOS: ad-hoc sign the whole app. An unsigned Apple silicon app is reported as "damaged" and
//    cannot run; an ad-hoc signature lets it start after the user approves it once.
//  - Linux: add the qs-vc launcher, which uses the Chromium sandbox when the system allows it and
//    otherwise refuses to run (ZIP extraction cannot keep chrome-sandbox setuid root).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const LINUX_LAUNCHER = `#!/bin/sh
# QS-VC launcher. Refuses to start if no Chromium sandbox is available.
HERE="$(dirname "$(readlink -f "$0")")"
BIN="$HERE/qs-vc-bin"
SANDBOX="$HERE/chrome-sandbox"
if [ -u "$SANDBOX" ] && [ "$(stat -c %u "$SANDBOX" 2>/dev/null)" = 0 ]; then exec "$BIN" "$@"; fi
if [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" != 1 ] && unshare -Ur true 2>/dev/null; then exec "$BIN" "$@"; fi
echo "QS-VC: this system blocks the Chromium sandbox; ask IT to configure it before starting." >&2
echo "To enable it, ask IT to run: sudo chown root:root '$SANDBOX' && sudo chmod 4755 '$SANDBOX'" >&2
exit 1
`;

exports.default = async function afterPack(context) {
    const out = context.appOutDir;
    if (context.electronPlatformName === 'darwin') {
        const app = path.join(out, `${context.packager.appInfo.productFilename}.app`);
        execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
        execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' });
    } else if (context.electronPlatformName === 'linux') {
        const launcher = path.join(out, 'qs-vc');
        fs.writeFileSync(launcher, LINUX_LAUNCHER, { mode: 0o755 });
        fs.chmodSync(launcher, 0o755);
    }
};
