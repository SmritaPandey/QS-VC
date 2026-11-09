import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

const randomProof = () => randomBytes(32).toString('base64url');

export async function createSsoLoopback() {
    const verifier = randomProof();
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const path = randomProof();
    let finish!: (code: string | undefined) => void;
    const result = new Promise<string | undefined>(resolve => { finish = resolve; });
    const server = createServer((request, response) => {
        let url: URL;
        try { url = new URL(request.url || '/', 'http://127.0.0.1'); }
        catch { response.writeHead(400).end(); return; }
        const port = (server.address() as AddressInfo | null)?.port;
        if (request.method !== 'GET' || request.headers.host !== `127.0.0.1:${port}` || url.pathname !== `/sso/${path}`) {
            response.writeHead(404).end();
            return;
        }
        const code = url.searchParams.get('code');
        const accepted = code && /^[\w-]{43}$/.test(code);
        response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'" })
            .end(accepted ? 'Return to QS-VC to finish signing in. You can close this tab.'
                : 'Organisation sign-in could not be verified. Return to QS-VC and try again.');
        finish(accepted ? code : undefined);
    });
    server.requestTimeout = 5000;
    server.headersTimeout = 5000;
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
    });
    server.on('error', () => finish(undefined));
    const timer = setTimeout(() => finish(undefined), 5 * 60 * 1000);
    const close = () => { clearTimeout(timer); server.close(); server.closeIdleConnections(); finish(undefined); };
    return { port: (server.address() as AddressInfo).port, path, verifier, challenge, result, close };
}
