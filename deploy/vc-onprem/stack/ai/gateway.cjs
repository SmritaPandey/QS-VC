const { createServer } = require('node:http');
const { readFileSync } = require('node:fs');
const { createDecipheriv, timingSafeEqual } = require('node:crypto');

const features = ['summaries', 'captions', 'search'];
const external = provider => provider !== 'local';
const blocked = classification => !['meeting', 'public'].includes(classification);

function decryptKey(file, kekFile) {
    const kek = readFileSync(kekFile);
    const value = readFileSync(file);
    if (kek.length !== 32 || value.length < 77 || value.subarray(0, 8).toString() !== 'QSVCBAK1') {
        throw new Error('Invalid encrypted AI credential');
    }
    try {
        const unwrap = createDecipheriv('id-aes256-wrap', kek, Buffer.alloc(8, 0xa6));
        const dek = Buffer.concat([unwrap.update(value.subarray(20, 60)), unwrap.final()]);
        try {
            const decrypt = createDecipheriv('aes-256-gcm', dek, value.subarray(8, 20));
            decrypt.setAAD(value.subarray(0, 60));
            decrypt.setAuthTag(value.subarray(-16));
            return Buffer.concat([decrypt.update(value.subarray(60, -16)), decrypt.final()]).toString('utf8').trim();
        } finally { dek.fill(0); }
    } finally { kek.fill(0); }
}

function createGateway(policy, { fetcher = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), audit = event => console.log(JSON.stringify(event)) } = {}) {
    const enabled = new Set(['standard', 'air-gapped', 'high-assurance']);
    if (!enabled.has(policy.profile)) throw new Error('Invalid AI profile');
    const counts = Object.fromEntries(features.map(feature => [feature, { used: 0, hour: -1, inFlight: 0 }]));
    const providers = policy.providers || {};
    const routes = policy.features || {};
    for (const [feature, route] of Object.entries(routes)) {
        if (!features.includes(feature) || !['local', 'openrouter', 'custom-endpoint'].includes(route.provider)
            || !Number.isSafeInteger(route.hourlyLimit) || route.hourlyLimit < 1 || route.hourlyLimit > 10000) {
            throw new Error('Invalid AI route');
        }
    }
    function stats() {
        const hour = Math.floor(Date.now() / 3600000);
        return Object.fromEntries(features.map(feature => [feature, {
            used: counts[feature].hour === hour ? counts[feature].used : 0,
            limit: routes[feature]?.hourlyLimit || 0,
            provider: routes[feature]?.provider || null,
        }]));
    }

    async function request(feature, classification, messages) {
        const route = routes[feature];
        if (!route) return { status: 503 };
        if (blocked(classification) || (external(route.provider) && (
            policy.profile !== 'standard' || route.allowExternal !== true || route.egressWarningAcknowledged !== true
        ))) return { status: 403 };
        const provider = providers[route.provider] || {};
        const isRouter = route.provider === 'openrouter';
        let base;
        try {
            base = new URL(isRouter ? 'https://openrouter.ai/api/v1/' : provider.baseUrl.replace(/\/?$/, '/'));
            if (base.username || base.password || base.search || base.hash
                || (external(route.provider) && base.protocol !== 'https:')
                || (route.provider === 'local' && (!['http:', 'https:'].includes(base.protocol)
                    || !/^(localhost|127\.0\.0\.1|ollama|vllm|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(base.hostname)))) return { status: 503 };
        } catch { return { status: 503 }; }
        const budget = counts[feature];
        const hour = Math.floor(Date.now() / 3600000);
        if (budget.hour !== hour) { budget.hour = hour; budget.used = 0; }
        if (budget.used >= route.hourlyLimit || budget.inFlight >= 2) return { status: 429 };
        budget.used++;
        budget.inFlight++;
        try {
            let key;
            if (provider.encryptedKey) key = decryptKey(provider.encryptedKey, provider.kekFile);
            if (isRouter && !key) return { status: 503 };
            const headers = { 'Content-Type': 'application/json', ...(key && { Authorization: 'Bearer ' + key }) };
            const deadline = Date.now() + 9000;
            async function call(path, body) {
                let status = 0;
                const started = Date.now();
                try {
                    const remaining = deadline - started;
                    if (remaining <= 0) return null;
                    const response = await fetcher(new URL(path, base), {
                        method: body ? 'POST' : 'GET', headers, redirect: 'error',
                        ...(body && { body: JSON.stringify(body) }),
                        signal: AbortSignal.timeout(Math.min(3500, remaining)),
                    });
                    status = response.status;
                    if (!response.ok) { await response.body?.cancel(); return { status }; }
                    return { status, json: await response.json() };
                } catch { return null; }
                finally {
                    if (external(route.provider)) audit({ event: 'ai.external.call', at: new Date().toISOString(),
                        feature, provider: route.provider, operation: path, status, durationMs: Date.now() - started });
                }
            }

            let models = [route.model];
            if (isRouter) {
                if (provider.discovery === true) {
                    const list = await call('models');
                    const tags = Array.isArray(route.capabilityTags) ? route.capabilityTags : [];
                    models = (Array.isArray(list?.json?.data) ? list.json.data : [])
                        .filter(model => typeof model.id === 'string' && model.id.endsWith(':free'))
                        .map(model => ({ id: model.id, length: Number(model.context_length) || 0,
                            score: tags.filter(tag => [...(model.supported_parameters || []), ...(model.architecture?.input_modalities || [])].includes(tag)).length }))
                        .sort((a, b) => b.score - a.score || b.length - a.length)
                        .slice(0, 4).map(model => model.id);
                } else models = [provider.freeRouter];
                models = models.filter(model => model === 'openrouter/free' || (typeof model === 'string' && model.endsWith(':free')));
            }
            for (let index = 0; index < models.length && Date.now() < deadline; index++) {
                const model = models[index];
                if (!model) continue;
                let result = await call('chat/completions', { model, messages, stream: false, max_tokens: 1200 });
                if (result?.status === 429 && index === 0) {
                    await sleep(250);
                    result = await call('chat/completions', { model, messages, stream: false, max_tokens: 1200 });
                }
                const content = result?.json?.choices?.[0]?.message?.content;
                if (typeof content === 'string' && content.trim()) return {
                    status: 200, body: { object: 'chat.completion', model,
                        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] },
                };
            }
            return { status: 503 };
        } catch { return { status: 503 }; }
        finally { budget.inFlight--; }
    }
    return { request, stats };
}

function authorized(header, token) {
    const expected = Buffer.from('Bearer ' + token);
    const actual = Buffer.from(header || '');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
}

if (require.main === module) {
    const gateway = createGateway(JSON.parse(readFileSync('/ai-config/policy.json', 'utf8')));
    const token = readFileSync('/ai-config/gateway-token', 'utf8').trim();
    if (token.length < 32) throw new Error('AI gateway token is too short');
    createServer(async (req, res) => {
        function send(status, data) {
            res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(data));
        }
        if (!authorized(req.headers.authorization, token)) return send(401, { error: { message: 'Unauthorized' } });
        if (req.method === 'GET' && req.url === '/usage') return send(200, gateway.stats());
        if (req.method !== 'POST' || req.url !== '/v1/chat/completions') return send(404, { error: { message: 'Not found' } });
        try {
            const chunks = [];
            let size = 0;
            for await (const chunk of req) {
                size += chunk.length;
                if (size > 128 * 1024) { send(413, { error: { message: 'Request too large' } }); return; }
                chunks.push(chunk);
            }
            const { messages, stream } = JSON.parse(Buffer.concat(chunks).toString());
            if (stream === true || !Array.isArray(messages) || !messages.length || messages.length > 100
                || messages.some(message => !message || !['system', 'user', 'assistant'].includes(message.role)
                    || typeof message.content !== 'string')) return send(400, { error: { message: 'Invalid chat request' } });
            const feature = req.headers['x-qsvc-ai-feature'] || 'summaries';
            if (!features.includes(feature)) return send(400, { error: { message: 'Invalid feature' } });
            const result = await gateway.request(feature, req.headers['x-qsvc-data-classification'] || 'meeting',
                messages.map(({ role, content }) => ({ role, content })));
            return send(result.status, result.body || { error: { message: result.status === 403
                ? 'AI request blocked by data policy' : 'AI temporarily unavailable' } });
        } catch { return send(400, { error: { message: 'Invalid chat request' } }); }
    }).listen(4011, '0.0.0.0');
}

module.exports = { createGateway };
