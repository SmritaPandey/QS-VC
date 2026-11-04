#!/usr/bin/env node
// Local development launcher. Production intranet uses a trusted HTTPS
// gateway, private services and organisation-managed access.
const { spawn } = require('child_process');
const path = require('path');
const net = require('net');
const os = require('os');
const fs = require('node:fs');

const ROOT = __dirname;
const SIGNALING_PORT = 4001;

const WEB_PORT = 5173;
const procs = [];

function log(service, msg) {
    const ts = new Date().toLocaleTimeString();
    console.log(`[${ts}] [${service}] ${msg}`);
}

function startService(name, cmd, args, cwd, env = {}) {
    log(name, `Starting: ${cmd} ${args.join(' ')}`);
    const proc = spawn(cmd, args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        env: { ...process.env, ...env },
    });

    proc.stdout.on('data', (d) => {
        d.toString().trim().split('\n').forEach(line => log(name, line));
    });
    proc.stderr.on('data', (d) => {
        d.toString().trim().split('\n').forEach(line => log(name, `⚠ ${line}`));
    });
    proc.on('exit', (code) => {
        log(name, `Exited with code ${code}`);
    });
    proc.on('error', (err) => {
        log(name, `Error: ${err.message}`);
    });

    return proc;
}

function isPortInUse(port) {
    return new Promise((resolve) => {
        const srv = net.createServer();
        srv.once('error', () => resolve(true));
        srv.once('listening', () => { srv.close(); resolve(false); });
        srv.listen(port);
    });
}

function canConnect(host, port, timeoutMs = 1500) {
    return new Promise((resolve) => {
        const socket = net.createConnection({ host, port });
        const finish = (reachable) => { socket.destroy(); resolve(reachable); };
        socket.setTimeout(timeoutMs, () => finish(false));
        socket.once('connect', () => finish(true));
        socket.once('error', () => finish(false));
    });
}

function waitForPort(port, timeout = 30000) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const check = () => {
            const sock = net.createConnection(port, '127.0.0.1');
            sock.on('connect', () => { sock.destroy(); resolve(); });
            sock.on('error', () => {
                if (Date.now() - start > timeout) {
                    reject(new Error(`Timed out waiting for port ${port}`));
                } else {
                    setTimeout(check, 500);
                }
            });
        };
        check();
    });
}

/** Get LAN IP addresses for sharing on intranet. */
function getLanIPs() {
    const interfaces = os.networkInterfaces();
    const ips = [];
    for (const [name, entries] of Object.entries(interfaces)) {
        for (const entry of entries) {
            if (entry.family === 'IPv4' && !entry.internal) {
                ips.push({ name, address: entry.address });
            }
        }
    }
    return ips;
}

async function main() {
    require('dotenv').config({ path: path.join(ROOT, '.env') });
    // MCU_ENABLED is retained as an alias for existing intranet .env files.
    // Both switches activate the real SFU-mounted Poly/FreeSWITCH bridge;
    // the memory-only services/mcu control stub is never used for media.
    const mcuEnabled = process.argv.includes('--mcu') || process.env.POLY_BRIDGE_ENABLED === 'true' || process.env.MCU_ENABLED === 'true';
    const bridgeModule = path.resolve(ROOT, process.env.POLY_BRIDGE_MODULE || 'deploy/poly-bridge/dist/index.js');
    if (mcuEnabled) {
        if (!fs.existsSync(bridgeModule)) throw new Error('Build deploy/poly-bridge before enabling the intranet MCU.');
        if (!process.env.SFU_CONTROL_TOKEN || process.env.SFU_CONTROL_TOKEN !== process.env.BRIDGE_API_TOKEN) {
            throw new Error('Set matching private SFU_CONTROL_TOKEN and BRIDGE_API_TOKEN values.');
        }
        for (const [key, defaultValue] of [['FS_ESL_PASSWORD', 'ClueCon'], ['DRACHTIO_SECRET', 'cymru']]) {
            if (!process.env[key]?.trim() || process.env[key] === defaultValue || process.env[key] === 'change-me') throw new Error(`Configure a private ${key} before enabling the intranet MCU.`);
        }
        for (const [name, host, port] of [
            ['FreeSWITCH ESL', process.env.FS_ESL_HOST || '127.0.0.1', Number(process.env.FS_ESL_PORT || 8021)],
            ['drachtio control', process.env.DRACHTIO_HOST || '127.0.0.1', Number(process.env.DRACHTIO_PORT || 9022)],
        ]) {
            if (!await canConnect(host, port)) throw new Error(`${name} is unreachable at ${host}:${port}. Start/configure the enterprise media services before enabling MCU mode.`);
        }
        if (await isPortInUse(4000) || await isPortInUse(SIGNALING_PORT)) {
            throw new Error('Stop the existing SFU and signaling processes before starting the MCU-enabled profile.');
        }
    }
    log('Intranet', mcuEnabled
        ? 'Poly/FreeSWITCH bridge mounted. Verify media for each call; service startup does not prove interoperability.'
        : 'Browser meeting mode. Room-device bridge disabled. Set MCU_ENABLED=true after configuring its dependencies to enable it.');

    const tsxPath = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    for (const [service, port] of [['sfu', 4000], ['auth', 4002], ['meeting', 4003], ['recording', 4004]]) {
        const cwd = path.join(ROOT, 'services', service);
        if (!(await isPortInUse(port))) {
            procs.push(startService(service, process.execPath, [tsxPath, 'src/index.ts'], cwd, {
                PORT: String(port),
                ...(service === 'sfu' ? { SFU_CONTROL_HOST: '127.0.0.1', POLY_BRIDGE_MODULE: mcuEnabled ? bridgeModule : '' } : {}),
                [`${service.toUpperCase()}_PORT`]: String(port),
            }));
        }
        await waitForPort(port);
        const response = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(3000) });
        if (!response.ok || (await response.json()).service !== `qsvc-${service}`) {
            throw new Error(`Port ${port} does not serve QS-VC ${service}.`);
        }
        if (service === 'auth' || service === 'meeting') {
            const ready = await fetch(`http://localhost:${port}/ready`, { signal: AbortSignal.timeout(8000) });
            if (!ready.ok) throw new Error(`QS-VC ${service} cannot reach its database. Check the root .env and PostgreSQL.`);
        }
    }

    // Start signaling after its dependencies are ready.
    const sigInUse = await isPortInUse(SIGNALING_PORT);
    if (sigInUse) {
        log('Signaling', `Already running on port ${SIGNALING_PORT}`);
    } else {
        log('Signaling', 'Starting signaling service...');
        const tsxPath = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
        const sigDir = path.join(ROOT, 'services', 'signaling');
        const sigProc = startService('Signaling', process.execPath, [tsxPath, 'src/index.ts'], sigDir, {
            PORT: String(SIGNALING_PORT),
            POLY_BRIDGE_ENABLED: String(mcuEnabled),
            MCU_ENABLED: String(mcuEnabled),
        });
        procs.push(sigProc);
    }

    log('Signaling', `Waiting for port ${SIGNALING_PORT}...`);
    await waitForPort(SIGNALING_PORT);
    log('Signaling', '✓ Signaling service is ready');

    // ── 3. Start Vite Dev Server ──
    const webInUse = await isPortInUse(WEB_PORT);
    if (webInUse) {
        log('Vite', `Already running on port ${WEB_PORT}`);
    } else {
        log('Vite', 'Starting Vite dev server...');
        const vitePath = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
        const viteProc = startService('Vite', process.execPath, [vitePath, '--host', '0.0.0.0'], path.join(ROOT, 'frontend', 'web'), {
            VITE_DEPLOYMENT_MODE: 'intranet',
        });
        procs.push(viteProc);
    }

    log('Vite', `Waiting for port ${WEB_PORT}...`);
    await waitForPort(WEB_PORT);
    log('Vite', '✓ Vite dev server is ready');

    // ── 4. Get LAN IPs ──
    const lanIPs = getLanIPs();

    // ── 5. Print Summary ──
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  🏢 QS-VC local development services are listening');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log('  📌 Development URLs (use test data):');
    console.log(`     Local:       http://localhost:${WEB_PORT}`);
    lanIPs.forEach(ip => {
        console.log(`     LAN (${ip.name}): http://${ip.address}:${WEB_PORT}`);
    });
    console.log('');
    console.log('  📡 SERVICES:');
    console.log(`     Signaling:   http://localhost:${SIGNALING_PORT}`);
    console.log(`     Web UI:      http://localhost:${WEB_PORT}`);
    console.log('');
    console.log('  Press Ctrl+C to stop all services');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');

    // ── Graceful Shutdown ──
    const shutdown = () => {
        log('Shutdown', 'Stopping all services...');
        procs.forEach(p => { try { p.kill(); } catch {} });
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch(err => {
    procs.forEach(proc => proc.kill());
    console.error('Fatal error:', err);
    process.exit(1);
});
