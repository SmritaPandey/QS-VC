#!/usr/bin/env node
// Local development launcher. Production intranet uses a trusted HTTPS
// gateway, private services and organisation-managed access.
const { spawn } = require('child_process');
const path = require('path');
const net = require('net');
const os = require('os');

const ROOT = __dirname;
const SIGNALING_PORT = 4001;
const MCU_PORT = 4005;
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
    console.log('');
    console.log('╔═══════════════════════════════════════════════════════╗');
    console.log('║   QS-VC — Enterprise Intranet Deployment (MCU Mode)  ║');
    console.log('║   Local development launcher                         ║');
    console.log('║   MCU Video Composition + Audio Mixing                ║');
    console.log('╚═══════════════════════════════════════════════════════╝');
    console.log('');

    const tsxPath = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    for (const [service, port] of [['sfu', 4000], ['auth', 4002], ['meeting', 4003], ['recording', 4004]]) {
        const cwd = path.join(ROOT, 'services', service);
        if (!(await isPortInUse(port))) {
            procs.push(startService(service, process.execPath, [tsxPath, 'src/index.ts'], cwd, {
                PORT: String(port),
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
            MCU_ENABLED: 'true',
            MCU_INTERNAL_URL: `http://127.0.0.1:${MCU_PORT}`,
        });
        procs.push(sigProc);
    }

    log('Signaling', `Waiting for port ${SIGNALING_PORT}...`);
    await waitForPort(SIGNALING_PORT);
    log('Signaling', '✓ Signaling service is ready');

    // ── 2. Start MCU Service ──
    const mcuInUse = await isPortInUse(MCU_PORT);
    if (mcuInUse) {
        log('MCU', `Already running on port ${MCU_PORT}`);
    } else {
        log('MCU', 'Starting local MCU control service (SIP/H.323 media gateway unavailable)...');
        const tsxPath = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
        const mcuEntry = path.join(ROOT, 'services', 'mcu', 'src', 'index.ts');
        const mcuProc = startService('MCU', process.execPath, [tsxPath, mcuEntry], ROOT, {
            MCU_PORT: String(MCU_PORT),
        });
        procs.push(mcuProc);
    }

    log('MCU', `Waiting for port ${MCU_PORT}...`);
    await waitForPort(MCU_PORT);
    log('MCU', 'MCU HTTP port is listening');

    // ── 3. Start Vite Dev Server ──
    const webInUse = await isPortInUse(WEB_PORT);
    if (webInUse) {
        log('Vite', `Already running on port ${WEB_PORT}`);
    } else {
        log('Vite', 'Starting Vite dev server...');
        const vitePath = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
        const viteProc = startService('Vite', process.execPath, [vitePath, '--host', '0.0.0.0'], path.join(ROOT, 'frontend', 'web'), {
            VITE_MCU_ENABLED: 'true',
            VITE_MCU_URL: `http://127.0.0.1:${MCU_PORT}`,
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
    console.log(`     MCU:         http://127.0.0.1:${MCU_PORT}`);
    console.log(`     MCU Health:  http://127.0.0.1:${MCU_PORT}/health`);
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
