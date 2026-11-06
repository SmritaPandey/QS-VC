#!/usr/bin/env node
/**
 * QS-VC deployment smoke check. Run it from a machine on the network your users are on:
 *
 *   node scripts/deploy-smoke-check.mjs https://meet.example.com [--ca ./internal-ca.crt] [--token <session>] [--skip-media]
 *
 * It proves, against the running deployment (not the source):
 *   1. TLS       – the certificate is trusted (or matches --ca) and is not about to expire
 *   2. Gateway   – /health answers through the reverse proxy
 *   3. Discovery – the browser config endpoint (/api/ice-servers) reaches signaling, and signaling
 *                  reaches the SFU: a test join returns real WebRTC transports
 *   4. TURN      – each TURN URL answers STUN and grants an authenticated relay allocation
 *   5. Media     – the SFU's announced UDP address answers an ICE connectivity check (the same
 *                  check a browser does), so SFU_ANNOUNCED_IP and the media port range are right
 *
 * Exit code 0 = everything passed; 1 = at least one check failed. Nothing is changed on the server.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { readFileSync } from 'node:fs';
import { connect as tlsConnect } from 'node:tls';
import { connect as netConnect } from 'node:net';
import https from 'node:https';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const base = new URL(args.find(a => /^https?:\/\//.test(a)) || process.env.QSVC_URL || '');
if (!base.host) { console.error('Usage: node scripts/deploy-smoke-check.mjs https://meet.example.com [--ca ca.crt] [--token session] [--skip-media]'); process.exit(2); }
const ca = flag('--ca') ? readFileSync(flag('--ca')) : undefined;
const token = flag('--token') || process.env.QSVC_SMOKE_TOKEN;
const skipMedia = args.includes('--skip-media');
const allowLoopback = args.includes('--allow-loopback'); // local development only

let failures = 0;
const pass = (name, detail = '') => console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
const fail = (name, detail) => { failures++; console.log(`  FAIL  ${name} — ${detail}`); };
const warn = (name, detail) => console.log(`  WARN  ${name} — ${detail}`);

function request(path, { method = 'GET', body, headers = {} } = {}) {
    const url = new URL(path, base);
    const lib = url.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
        const req = lib.request(url, { method, ca, timeout: 8000, headers: { 'content-type': 'application/json', ...headers } }, res => {
            let data = ''; res.on('data', c => data += c); res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        req.on('timeout', () => req.destroy(new Error('timed out')));
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

// ── STUN / TURN (RFC 5389 / 5766) ────────────────────────────────────────────
const MAGIC = 0x2112a442;
function stunMessage(type, attrs, integrityKey, fingerprint = false) {
    const tid = randomBytes(12);
    const encode = list => Buffer.concat(list.map(([t, v]) => {
        const pad = (4 - (v.length % 4)) % 4;
        const h = Buffer.alloc(4); h.writeUInt16BE(t, 0); h.writeUInt16BE(v.length, 2);
        return Buffer.concat([h, v, Buffer.alloc(pad)]);
    }));
    let body = encode(attrs);
    const header = len => { const h = Buffer.alloc(20); h.writeUInt16BE(type, 0); h.writeUInt16BE(len, 2); h.writeUInt32BE(MAGIC, 4); tid.copy(h, 8); return h; };
    if (integrityKey) {
        const mac = createHmac('sha1', integrityKey).update(Buffer.concat([header(body.length + 24), body])).digest();
        body = Buffer.concat([body, encode([[0x0008, mac]])]);
    }
    if (fingerprint) {
        const crc = (crc32(Buffer.concat([header(body.length + 8), body])) ^ 0x5354554e) >>> 0;
        const v = Buffer.alloc(4); v.writeUInt32BE(crc, 0);
        body = Buffer.concat([body, encode([[0x8028, v]])]);
    }
    return { tid, buffer: Buffer.concat([header(body.length), body]) };
}
function parseStun(buf) {
    if (buf.length < 20 || buf.readUInt32BE(4) !== MAGIC) return null;
    const attrs = new Map(); let o = 20;
    while (o + 4 <= buf.length) { const t = buf.readUInt16BE(o), l = buf.readUInt16BE(o + 2); attrs.set(t, buf.subarray(o + 4, o + 4 + l)); o += 4 + l + ((4 - (l % 4)) % 4); }
    return { type: buf.readUInt16BE(0), tid: buf.subarray(8, 20), attrs };
}
function xorAddress(v) {
    const port = v.readUInt16BE(2) ^ (MAGIC >>> 16);
    const ip = [0, 1, 2, 3].map(i => v[4 + i] ^ ((MAGIC >>> (24 - 8 * i)) & 0xff)).join('.');
    return `${ip}:${port}`;
}
let crcTable;
function crc32(buf) {
    crcTable ||= Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0;
}
/** One UDP socket or TCP connection reused for several STUN transactions (TURN nonces are per 5-tuple). */
function openChannel(host, port, transport) {
    const waiting = new Map();
    let buffer = Buffer.alloc(0);
    const deliver = parsed => { const key = parsed.tid.toString('hex'); const w = waiting.get(key); if (w) { waiting.delete(key); clearTimeout(w.timer); w.resolve(parsed); } };
    let socket, ready;
    if (transport === 'tcp') {
        socket = netConnect({ host, port });
        ready = new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
        socket.on('data', chunk => {
            buffer = Buffer.concat([buffer, chunk]);
            while (buffer.length >= 20) {
                const len = 20 + buffer.readUInt16BE(2);
                if (buffer.length < len) break;
                const parsed = parseStun(buffer.subarray(0, len)); buffer = buffer.subarray(len);
                if (parsed) deliver(parsed);
            }
        });
        socket.on('error', e => { for (const w of waiting.values()) w.reject(e); waiting.clear(); });
    } else {
        socket = createSocket('udp4');
        ready = Promise.resolve();
        socket.on('message', msg => { const parsed = parseStun(msg); if (parsed) deliver(parsed); });
        socket.on('error', e => { for (const w of waiting.values()) w.reject(e); waiting.clear(); });
    }
    return {
        async exchange(message, timeoutMs = 3000) {
            await ready;
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => { waiting.delete(message.tid.toString('hex')); reject(new Error(`no ${transport.toUpperCase()} answer from ${host}:${port}`)); }, timeoutMs);
                waiting.set(message.tid.toString('hex'), { resolve, reject, timer });
                if (transport === 'tcp') socket.write(message.buffer); else socket.send(message.buffer, port, host);
            });
        },
        close() { try { transport === 'tcp' ? socket.destroy() : socket.close(); } catch { /* closed */ } },
    };
}
async function udpExchange(host, port, message, timeoutMs = 3000) {
    const channel = openChannel(host, port, 'udp');
    try { return await channel.exchange(message, timeoutMs); } finally { channel.close(); }
}

async function checkTurn(server) {
    for (const raw of [].concat(server.urls)) {
        const m = /^(turns?):\[?([^\]?]+?)\]?(?::(\d+))?(?:\?transport=(udp|tcp))?$/i.exec(raw);
        if (!m) continue;
        const [, scheme, host, portText, transportText] = m;
        if (scheme.toLowerCase() === 'turns') { warn(`TURN ${raw}`, 'TLS TURN is not probed by this script'); continue; }
        const port = Number(portText || 3478), transport = (transportText || 'udp').toLowerCase();
        const channel = openChannel(host, port, transport);
        const exchange = (_h, _p, message) => channel.exchange(message, 4000);
        try {
            const binding = await exchange(host, port, stunMessage(0x0001, []));
            if (binding.type !== 0x0101) throw new Error('STUN binding failed');
            const reqTransport = Buffer.from([17, 0, 0, 0]);
            const first = await exchange(host, port, stunMessage(0x0003, [[0x0019, reqTransport]]));
            const realm = first.attrs.get(0x0014)?.toString(), nonce = first.attrs.get(0x0015);
            if (!realm || !nonce) throw new Error('server did not ask for credentials (open relays are not allowed)');
            if (!server.username || !server.credential) { warn(`TURN ${raw}`, 'answers, but no credentials were published to test an allocation'); continue; }
            const key = createHash('md5').update(`${server.username}:${realm}:${server.credential}`).digest();
            const alloc = await exchange(host, port, stunMessage(0x0003, [
                [0x0019, reqTransport], [0x0006, Buffer.from(server.username)], [0x0014, Buffer.from(realm)], [0x0015, nonce],
            ], key));
            if (alloc.type !== 0x0103) {
                const err = alloc.attrs.get(0x0009);
                throw new Error(`allocation refused${err ? ` (${err.readUInt8(2) * 100 + err.readUInt8(3)} ${err.subarray(4).toString()})` : ''}`);
            }
            const relay = alloc.attrs.get(0x0016);
            pass(`TURN ${raw}`, `relay ${relay ? xorAddress(relay) : 'allocated'}`);
        } catch (error) { fail(`TURN ${raw}`, error.message); }
        finally { channel.close(); }
    }
}

async function checkTls() {
    if (base.protocol !== 'https:') { fail('TLS', 'the site is not served over HTTPS'); return; }
    await new Promise(resolve => {
        const socket = tlsConnect({ host: base.hostname, port: Number(base.port || 443), servername: base.hostname, ca, timeout: 8000 }, () => {
            const cert = socket.getPeerCertificate();
            const days = Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 86_400_000);
            if (!socket.authorized) fail('TLS', `certificate not trusted: ${socket.authorizationError}`);
            else if (days < 14) fail('TLS', `certificate expires in ${days} days`);
            else pass('TLS', `${socket.getProtocol()}, certificate valid for ${days} more days`);
            socket.end(); resolve();
        });
        socket.on('error', e => { fail('TLS', e.message); resolve(); });
        socket.on('timeout', () => { fail('TLS', 'timed out'); socket.destroy(); resolve(); });
    });
}

async function checkSignalingAndMedia(iceServers) {
    let WebSocket;
    try { WebSocket = require('ws'); } catch { fail('Signaling', 'install dependencies first (npm ci) — the ws package is needed'); return; }
    let ticket;
    const meetingCode = `SMOKE-${randomBytes(3).toString('hex').toUpperCase()}`;
    if (token) {
        // Tickets are single-use and bound to one meeting code.
        const res = await request('/api/signaling-ticket', { method: 'POST', body: { meetingCode }, headers: { Authorization: `Bearer ${token}` } }).catch(e => ({ status: 0, body: e.message }));
        if (res.status !== 200) { fail('Signaling ticket', `HTTP ${res.status}`); return; }
        ticket = JSON.parse(res.body).ticket;
    }
    const wsUrl = new URL('/ws', base); wsUrl.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(wsUrl, { ca, origin: base.origin });
    const pending = new Map(); let nextId = 1;
    const rpc = (method, params) => new Promise((resolve, reject) => {
        const id = nextId++; pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
        setTimeout(() => { if (pending.delete(id)) reject(new Error(`${method} timed out`)); }, 10_000);
    });
    try {
        await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); ws.once('unexpected-response', (_q, r) => reject(new Error(`WebSocket upgrade refused: HTTP ${r.statusCode}`))); });
        ws.on('message', raw => {
            const msg = JSON.parse(String(raw));
            const p = pending.get(msg.id);
            if (p) { pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); }
        });
        const auth = await new Promise((resolve, reject) => {
            pending.set(0, { resolve, reject });
            ws.send(JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'authenticate', params: ticket ? { ticket } : { guest: true } }));
            setTimeout(() => reject(new Error('authentication timed out')), 8000);
        });
        if (!auth?.authenticated) throw new Error('signaling refused authentication');
        pass('Signaling', `WebSocket authenticated as ${ticket ? 'signed-in user' : 'guest'}`);
        const join = await rpc('joinRoom', { meetingCode, displayName: 'Deployment smoke check', supportsE2EE: true });
        if (join?.status && join.status !== 'joined' && !join.sendTransport) { warn('Discovery', `join returned "${join.status}" (meeting policy); use --token for an organisation account`); return; }
        if (!join?.sfuAvailable || !join.sendTransport) { fail('Discovery', 'signaling could not reach the SFU (check SFU_INTERNAL_URL and SFU_CONTROL_TOKEN)'); return; }
        pass('Discovery', 'signaling → SFU transport created');
        if (skipMedia) return;
        const { iceParameters, iceCandidates } = join.sendTransport;
        const udp = iceCandidates.filter(c => (c.protocol || '').toLowerCase() === 'udp');
        if (!udp.length) { fail('Media', 'SFU offered no UDP candidates'); return; }
        for (const candidate of udp) {
            const address = candidate.address || candidate.ip;
            if (!allowLoopback && /^(127\.|0\.0\.0\.0)/.test(address)) { fail('Media', `SFU announces ${address}; set SFU_ANNOUNCED_IP to an address clients can reach`); continue; }
            try {
                const tie = randomBytes(8), priority = Buffer.alloc(4); priority.writeUInt32BE(1853824767, 0);
                const check = stunMessage(0x0001, [
                    [0x0006, Buffer.from(`${iceParameters.usernameFragment}:smoke`)], [0x0024, priority], [0x802a, tie],
                ], Buffer.from(iceParameters.password), true);
                const answer = await udpExchange(address, candidate.port, check, 3000);
                if (answer.type !== 0x0101) throw new Error('ICE check rejected');
                pass('Media', `SFU UDP ${address}:${candidate.port} answered an ICE connectivity check`);
            } catch (error) {
                const relay = (iceServers || []).some(s => [].concat(s.urls).some(u => /^turns?:/.test(u)));
                fail('Media', `${address}:${candidate.port}/udp unreachable from here (${error.message})${relay ? '; clients can still use TURN' : '; open the SFU UDP port range in the firewall'}`);
            }
        }
    } catch (error) { fail('Signaling', error.message); }
    finally { try { await rpc('leaveRoom', {}).catch(() => undefined); } catch { /* closing */ } ws.close(); }
}

console.log(`QS-VC deployment smoke check: ${base.origin}`);
await checkTls();
try {
    const health = await request('/health');
    health.status === 200 ? pass('Gateway', '/health') : fail('Gateway', `/health returned HTTP ${health.status}`);
} catch (error) { fail('Gateway', error.message); }
let iceServers = [];
try {
    const res = await request('/api/ice-servers');
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    iceServers = JSON.parse(res.body).iceServers || [];
    const turn = iceServers.filter(s => [].concat(s.urls).some(u => /^turns?:/.test(u)));
    turn.length ? pass('ICE config', `${turn.length} TURN server entr${turn.length === 1 ? 'y' : 'ies'} published`) : warn('ICE config', 'no TURN server published; users behind strict firewalls will have no audio/video');
    for (const server of turn) await checkTurn(server);
} catch (error) { fail('ICE config', `/api/ice-servers: ${error.message}`); }
await checkSignalingAndMedia(iceServers);
console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
