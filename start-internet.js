#!/usr/bin/env node
/**
 * QS-VC Internet Launch Script (Cloudflare Tunnel Edition)
 * Starts local services + creates a FREE Cloudflare tunnel.
 * 
 * No domain, no signup, no passwords, no interstitial pages.
 * Share the link on WhatsApp and anyone can join from mobile/laptop!
 * 
 * Usage: node start-internet.js
 */
const { spawn } = require('child_process');
const path = require('path');
const net = require('net');

const ROOT = __dirname;
const SIGNALING_PORT = 4001;
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

/**
 * Start cloudflared tunnel by spawning the binary directly.
 * Parses the tunnel URL from stderr output.
 */
function startCloudflaredTunnel(port) {
    return new Promise((resolve, reject) => {
        const binPath = path.join(ROOT, 'node_modules', 'cloudflared', 'bin', 'cloudflared.exe');
        const args = ['tunnel', '--url', `http://localhost:${port}`, '--no-autoupdate'];
        
        log('Tunnel', `Starting cloudflared: ${binPath} ${args.join(' ')}`);
        
        const proc = spawn(binPath, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let tunnelUrl = null;
        let resolved = false;
        const urlRegex = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/;

        const handleOutput = (data) => {
            const text = data.toString();
            text.split('\n').forEach(line => {
                const trimmed = line.trim();
                if (trimmed) log('Tunnel', trimmed);
                
                // Look for the tunnel URL in the output
                if (!resolved) {
                    const match = trimmed.match(urlRegex);
                    if (match) {
                        tunnelUrl = match[0];
                        resolved = true;
                        resolve({ url: tunnelUrl, proc });
                    }
                }
            });
        };

        proc.stdout.on('data', handleOutput);
        proc.stderr.on('data', handleOutput);

        proc.on('error', (err) => {
            if (!resolved) {
                resolved = true;
                reject(err);
            }
        });

        proc.on('exit', (code) => {
            if (!resolved) {
                resolved = true;
                reject(new Error(`cloudflared exited with code ${code}`));
            }
        });

        // Timeout after 30 seconds
        setTimeout(() => {
            if (!resolved) {
                resolved = true;
                reject(new Error('Tunnel creation timed out'));
            }
        }, 30000);
    });
}

async function main() {
    console.log('');
    console.log('╔═══════════════════════════════════════════════╗');
    console.log('║   QS-VC — Internet Deployment (Free Trial)   ║');
    console.log('║   ☁️  Powered by Cloudflare Tunnel             ║');
    console.log('║   No domain • No signup • No passwords       ║');
    console.log('╚═══════════════════════════════════════════════╝');
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
        });
        procs.push(sigProc);
    }

    log('Signaling', `Waiting for port ${SIGNALING_PORT}...`);
    await waitForPort(SIGNALING_PORT);
    log('Signaling', '✓ Signaling service is ready');

    // ── 2. Start Vite Dev Server ──
    // DO NOT set VITE_SIGNALING_URL — let it auto-detect from the page hostname.
    // Vite proxy handles /api → localhost:4001 and /ws → ws://localhost:4001
    const webInUse = await isPortInUse(WEB_PORT);
    if (webInUse) {
        log('Vite', `Already running on port ${WEB_PORT}`);
    } else {
        log('Vite', 'Starting Vite dev server...');
        const vitePath = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
        const viteProc = startService('Vite', process.execPath, [vitePath, '--host', '0.0.0.0'], path.join(ROOT, 'frontend', 'web'));
        procs.push(viteProc);
    }

    log('Vite', `Waiting for port ${WEB_PORT}...`);
    await waitForPort(WEB_PORT);
    log('Vite', '✓ Vite dev server is ready');

    // ── 3. Create Cloudflare Tunnel ──
    // Since Vite proxies /api and /ws to signaling, we only need ONE tunnel!
    log('Tunnel', 'Creating Cloudflare tunnel (this may take 15-30 seconds)...');
    let tunnelUrl = null;
    let tunnelProc = null;
    try {
        const result = await startCloudflaredTunnel(WEB_PORT);
        tunnelUrl = result.url;
        tunnelProc = result.proc;
        procs.push(tunnelProc);
    } catch (err) {
        log('Tunnel', `⚠ Tunnel creation failed: ${err.message}`);
        log('Tunnel', 'You can still use LAN access');
    }

    // ── 4. Print Summary ──
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  🚀 QS-VC is LIVE on the Internet!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    if (tunnelUrl) {
        console.log(`  🌐 Website:       ${tunnelUrl}`);
        console.log(`  📹 Start a VC:    ${tunnelUrl}/app`);
        console.log('');
        console.log('  ══════════════════════════════════════════════════');
        console.log('  📱 SHARE THIS ON WHATSAPP:');
        console.log('');
        console.log(`     ${tunnelUrl}/app`);
        console.log('');
        console.log('  ══════════════════════════════════════════════════');
        console.log('');
        console.log('  ✅ No passwords, no signup — just open & join!');
        console.log('  ✅ Works on mobile (Android/iOS) and laptop');
        console.log('  ✅ HTTPS secured by Cloudflare (free)');
    } else {
        console.log(`  🌐 Local only:  http://localhost:${WEB_PORT}`);
    }
    console.log('');
    console.log('  Press Ctrl+C to stop all services');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
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
