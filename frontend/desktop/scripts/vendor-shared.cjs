'use strict';
// Copies the shared modules the desktop app uses into its own package. The packaged app runs from
// app.asar and cannot reach the repository's shared/ folder, so anything it requires must live here.
const fs = require('fs');
const path = require('path');

const desktop = path.resolve(__dirname, '..');
const shared = path.resolve(desktop, '..', '..', 'shared');
const copies = [
    ['entitlements.cjs', path.join(desktop, 'dist', 'vendor', 'entitlements.cjs')],
    ['entitlements.d.cts', path.join(desktop, 'src', 'vendor', 'entitlements.d.cts')],
];
for (const [name, target] of copies) {
    const source = path.join(shared, name);
    if (!fs.existsSync(source)) { console.error(`Missing ${source}; build from a full repository checkout.`); process.exit(1); }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
}
