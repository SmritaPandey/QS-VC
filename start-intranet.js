#!/usr/bin/env node
/**
 * QS-VC Intranet (Enterprise MCU) Launch Script
 * Starts all local services for enterprise/intranet deployment:
 *   1. Signaling Server (port 4001)
 *   2. MCU Service (port 4002) — video composition, SIP/H.323 gateway
 *   3. Vite Dev Server (port 5173)
 *
 * Network: LAN/MPLS VPN/IPSec — no internet tunnel
 *
 * Usage: node start-intranet.js
 */
const { spawn } = require('child_process');
const path = require('path');
const net = require('net');
const os = require('os');

const ROOT = __dirname;
const SIGNALING_PORT = 4001;
const MCU_PORT = 4002;
const WEB_PORT = 5173;

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
    console.log('║   🏢 On-Premise • SIP/H.323 • Quantum-Safe E2EE     ║');
    console.log('║   MCU Video Composition + Audio Mixing                ║');
    console.log('╚═══════════════════════════════════════════════════════╝');
    console.log('');

    const procs = [];

    // ── 1. Start Signaling Service ──
    const sigInUse = await isPortInUse(SIGNALING_PORT);
    if (sigInUse) {
        log('Signaling', `Already running on port ${SIGNALING_PORT}`);
    } else {
        log('Signaling', 'Starting signaling service...');
        const tsxPath = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
        const sigEntry = path.join(ROOT, 'services', 'signaling', 'src', 'index.ts');
        const sigProc = startService('Signaling', process.execPath, [tsxPath, sigEntry], ROOT, {
            CORS_ORIGINS: '*',
            MCU_ENABLED: 'true',
            MCU_URL: `http://localhost:${MCU_PORT}`,
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
        log('MCU', 'Starting MCU service (video composition + SIP/H.323 gateway)...');
        const tsxPath = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
        const mcuEntry = path.join(ROOT, 'services', 'mcu', 'src', 'index.ts');
        const mcuProc = startService('MCU', process.execPath, [tsxPath, mcuEntry], ROOT, {
            MCU_PORT: String(MCU_PORT),
        });
        procs.push(mcuProc);
    }

    log('MCU', `Waiting for port ${MCU_PORT}...`);
    await waitForPort(MCU_PORT);
    log('MCU', '✓ MCU service is ready (GStreamer compositor + SIP/H.323 bridge)');

    // ── 3. Start Vite Dev Server ──
    const webInUse = await isPortInUse(WEB_PORT);
    if (webInUse) {
        log('Vite', `Already running on port ${WEB_PORT}`);
    } else {
        log('Vite', 'Starting Vite dev server...');
        const vitePath = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
        const viteProc = startService('Vite', process.execPath, [vitePath, '--host', '0.0.0.0'], path.join(ROOT, 'frontend', 'web'), {
            VITE_MCU_ENABLED: 'true',
            VITE_MCU_URL: `http://localhost:${MCU_PORT}`,
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
    console.log('  🏢 QS-VC ENTERPRISE (Intranet MCU Mode) is RUNNING!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log('  📌 ACCESS URLs (share within your intranet):');
    console.log(`     Local:       http://localhost:${WEB_PORT}`);
    lanIPs.forEach(ip => {
        console.log(`     LAN (${ip.name}): http://${ip.address}:${WEB_PORT}`);
    });
    console.log('');
    console.log('  📡 SERVICES:');
    console.log(`     Signaling:   http://localhost:${SIGNALING_PORT}`);
    console.log(`     MCU:         http://localhost:${MCU_PORT}`);
    console.log(`     MCU Health:  http://localhost:${MCU_PORT}/health`);
    console.log(`     Web UI:      http://localhost:${WEB_PORT}`);
    console.log('');
    console.log('  🎬 MCU CAPABILITIES:');
    console.log('     Layouts:     grid | speaker | presentation | spotlight | filmstrip');
    console.log('     Recording:   Server-side composite (MP4)');
    console.log('     SIP Gateway: sip:<meeting-code>@localhost:5060');
    console.log('     H.323:       localhost:1720');
    console.log('     RTMP Ingest: rtmp://localhost/live');
    console.log('');
    console.log('  📞 SIP/H.323 ENDPOINT SUPPORT:');
    console.log('     ✓ Polycom HDX/Group/Trio/Studio/G7500');
    console.log('     ✓ Cisco TelePresence SX/MX/Room Kit/Board');
    console.log('     ✓ PeopleLink Ultra/Sky/Blaze/Auro');
    console.log('     ✓ Lifesize Icon/Cloud');
    console.log('     ✓ Avaya Scopia/B-Series');
    console.log('     ✓ Huawei TE/CE Series');
    console.log('');
    console.log('  🔐 SECURITY:');
    console.log('     ✓ Quantum-Safe E2EE (Kyber-1024 + Dilithium-5)');
    console.log('     ✓ NIST FIPS 203/204/205 compliant');
    console.log('     ✓ AES-256-GCM symmetric encryption');
    console.log('');
    console.log('  🌐 AI TRANSLATION:');
    console.log('     ✓ 50+ languages (all 22 Indian scheduled languages)');
    console.log('     ✓ Real-time voice translation (STT → Translate → TTS)');
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
    console.error('Fatal error:', err);
    process.exit(1);
});
