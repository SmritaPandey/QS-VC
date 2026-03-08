#!/usr/bin/env node
/**
 * QS-VC Local Startup Script
 * Starts both Signaling service and Vite dev server.
 * Usage: node start-local.js
 */
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const ROOT = __dirname;

function log(service, msg) {
    const ts = new Date().toLocaleTimeString();
    console.log(`[${ts}] [${service}] ${msg}`);
}

function startService(name, cmd, args, cwd) {
    log(name, `Starting: ${cmd} ${args.join(' ')}`);
    const proc = spawn(cmd, args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
    });

    proc.stdout.on('data', (d) => {
        d.toString().trim().split('\n').forEach(line => log(name, line));
    });
    proc.stderr.on('data', (d) => {
        d.toString().trim().split('\n').forEach(line => log(name, `⚠ ${line}`));
    });
    proc.on('exit', (code) => {
        log(name, `Exited with code ${code}`);
        if (code !== 0 && code !== null) {
            log(name, 'Restarting in 3s...');
            setTimeout(() => startService(name, cmd, args, cwd), 3000);
        }
    });
    proc.on('error', (err) => {
        log(name, `Error: ${err.message}`);
    });

    return proc;
}

// Check if a port is in use
function isPortInUse(port) {
    return new Promise((resolve) => {
        const srv = require('net').createServer();
        srv.once('error', () => resolve(true));
        srv.once('listening', () => { srv.close(); resolve(false); });
        srv.listen(port);
    });
}

async function main() {
    console.log('');
    console.log('╔══════════════════════════════════════════╗');
    console.log('║   QS-VC — Local Development Environment ║');
    console.log('╚══════════════════════════════════════════╝');
    console.log('');

    // Check Docker containers
    log('Docker', 'Checking infrastructure containers...');
    try {
        const { execSync } = require('child_process');
        const ps = execSync('docker ps --format "{{.Names}}: {{.Status}}" --filter name=qsvc', { encoding: 'utf8' });
        ps.trim().split('\n').forEach(l => log('Docker', `  ${l}`));
    } catch {
        log('Docker', '⚠ Docker not available — infrastructure containers may not be running');
    }

    console.log('');

    // Start Signaling service
    const signalingInUse = await isPortInUse(4001);
    let sigProc;
    if (signalingInUse) {
        log('Signaling', 'Already running on port 4001');
    } else {
        const tsxPath = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
        const signalingEntry = path.join(ROOT, 'services', 'signaling', 'src', 'index.ts');
        sigProc = startService('Signaling', process.execPath, [tsxPath, signalingEntry], ROOT);
    }

    // Wait for signaling to be ready
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Start Vite dev server
    const viteInUse = await isPortInUse(5173);
    let viteProc;
    if (viteInUse) {
        log('Vite', 'Already running on port 5173');
    } else {
        const vitePath = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
        viteProc = startService('Vite', process.execPath, [vitePath, '--host', '0.0.0.0'], path.join(ROOT, 'frontend', 'web'));
    }

    console.log('');
    log('Ready', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    log('Ready', 'QS-VC is starting up...');
    log('Ready', '');
    log('Ready', '  Web UI:    http://localhost:5173');
    log('Ready', '  Signaling: http://localhost:4001');
    log('Ready', '');
    log('Ready', '  Press Ctrl+C to stop all services');
    log('Ready', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Handle shutdown
    process.on('SIGINT', () => {
        log('Shutdown', 'Stopping all services...');
        if (sigProc) sigProc.kill();
        if (viteProc) viteProc.kill();
        process.exit(0);
    });
    process.on('SIGTERM', () => {
        if (sigProc) sigProc.kill();
        if (viteProc) viteProc.kill();
        process.exit(0);
    });
}

main().catch(console.error);
