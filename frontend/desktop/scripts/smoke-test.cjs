'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// Node is present on every build runner; GNU timeout is not present on macOS.
function runSmokeTest(resultFile, command, args = [], timeout = 120_000) {
    resultFile = path.resolve(resultFile);
    fs.rmSync(resultFile, { force: true });
    const child = spawnSync(command, args, {
        env: { ...process.env, QSVC_SMOKE_TEST: resultFile },
        stdio: 'inherit',
        timeout,
        killSignal: 'SIGKILL',
        windowsHide: true,
    });
    if (child.error) {
        return { ok: false, message: child.error.code === 'ETIMEDOUT'
            ? `App startup timed out after ${timeout / 1000} seconds`
            : `Could not start app: ${child.error.message}` };
    }
    if (child.status !== 0) {
        return { ok: false, message: `App exited with ${child.signal || `code ${child.status}`}` };
    }
    if (!fs.existsSync(resultFile)) {
        return { ok: false, message: 'App exited without confirming that its start page rendered' };
    }
    const result = fs.readFileSync(resultFile, 'utf8').trim();
    return result === 'OK'
        ? { ok: true, message: 'OK: packaged app rendered its start page' }
        : { ok: false, message: `App start page failed: ${result || 'empty result'}` };
}

module.exports = { runSmokeTest };

if (require.main === module) {
    const [resultFile, command, ...args] = process.argv.slice(2);
    if (!resultFile || !command) {
        console.error('Usage: node smoke-test.cjs <result-file> <command> [args...]');
        process.exitCode = 1;
    } else {
        const result = runSmokeTest(resultFile, command, args);
        console.log(result.message);
        process.exitCode = result.ok ? 0 : 1;
    }
}
