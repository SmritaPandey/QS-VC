const publicApi = /^\/api\/(auth|meetings|recordings|sfu|users|admin)(\/|$)/;

// Browser security headers for the website (OWASP A05 / ISO 27001 A.8.26). CSP is enforced for every HTML asset and API error response.
const SECURITY_HEADERS = {
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(self), microphone=(self), display-capture=(self), speaker-selection=(self), geolocation=(), payment=(self "https://api.razorpay.com" "https://sdk.cashfree.com"), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://checkout.razorpay.com https://sdk.cashfree.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self' wss: https:; worker-src 'self' blob:; frame-src https://*.razorpay.com https://*.cashfree.com https://www.paypal.com https://www.sandbox.paypal.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
};

function withSecurityHeaders(response) {
    const secured = new Response(response.body, response);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        if (!secured.headers.has(name)) secured.headers.set(name, value);
    }
    return secured;
}

function error(message, status) {
    return withSecurityHeaders(Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } }));
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname === '/api/health') {
            return withSecurityHeaders(Response.json({ service: 'qs-vc-edge', runtime: 'worker' }, {
                headers: { 'Cache-Control': 'no-store' },
            }));
        }
        const signaling = url.pathname === '/ws' || url.pathname.startsWith('/ws/');
        const api = url.pathname === '/api' || url.pathname.startsWith('/api/');
        if (!api && !signaling) return withSecurityHeaders(await env.ASSETS.fetch(request));
        if (api && !publicApi.test(url.pathname) && url.pathname !== '/api/ice-servers' && url.pathname !== '/api/signaling-ticket') return error('API route not found.', 404);

        let backend;
        try {
            backend = new URL(env.BACKEND_ORIGIN);
            if (backend.protocol !== 'https:' || backend.username || backend.password
                || backend.pathname !== '/' || backend.search || backend.hash
                || backend.hostname.replace(/^www\./, '') === url.hostname.replace(/^www\./, '')) {
                throw new Error('Invalid backend origin');
            }
        } catch {
            return error('Meeting backend is not configured.', 503);
        }
        if (typeof env.ORIGIN_AUTH_SECRET !== 'string' || env.ORIGIN_AUTH_SECRET.length < 32) {
            return error('Meeting backend authentication is not configured.', 503);
        }

        const target = new URL(url.pathname + url.search, backend);
        // Never follow backend redirects with a participant's authorization header.
        const upstream = new Request(target, request);
        upstream.headers.delete('host');
        // Always replace client-supplied credentials; only the edge knows this secret.
        upstream.headers.set('X-QSVC-Origin', env.ORIGIN_AUTH_SECRET);
        try {
            const response = await fetch(new Request(upstream, { redirect: 'manual' }));
            return response.status === 101 ? response : withSecurityHeaders(response);
        } catch {
            return error('Meeting backend is unavailable. Try again shortly.', 502);
        }
    },
};
