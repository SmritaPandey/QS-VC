const publicApi = /^\/api\/(auth|meetings|recordings|sfu|users|admin)(\/|$)/;

function error(message, status) {
    return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname === '/api/health') {
            return Response.json({ service: 'qs-vc-edge', runtime: 'worker' }, {
                headers: { 'Cache-Control': 'no-store' },
            });
        }
        const signaling = url.pathname === '/ws' || url.pathname.startsWith('/ws/');
        const api = url.pathname === '/api' || url.pathname.startsWith('/api/');
        if (!api && !signaling) return env.ASSETS.fetch(request);
        if (api && !publicApi.test(url.pathname) && url.pathname !== '/api/ice-servers') return error('API route not found.', 404);

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

        const target = new URL(url.pathname + url.search, backend);
        // Never follow backend redirects with a participant's authorization header.
        const upstream = new Request(target, request);
        upstream.headers.delete('host');
        try {
            return await fetch(new Request(upstream, { redirect: 'manual' }));
        } catch {
            return error('Meeting backend is unavailable. Try again shortly.', 502);
        }
    },
};
