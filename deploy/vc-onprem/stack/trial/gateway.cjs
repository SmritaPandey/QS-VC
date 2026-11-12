const { createServer } = require('node:http');
const { trialState } = require('./state.cjs');

const contact = 'https://qsvcmeet.com/contact?interest=Enterprise';
createServer((req, res) => {
    const state = trialState();
    res.setHeader('Cache-Control', 'no-store');
    if (state === 'active') {
        res.writeHead(204).end();
        return;
    }
    const expired = state === 'expired';
    const title = expired ? 'Your 14-day trial has ended' : 'This workspace is unavailable';
    const message = expired ? 'Contact QS-VC to continue using this On-prem workspace.' : 'Ask your administrator to check the On-prem installation.';
    res.statusCode = expired ? 403 : 503;
    if (!(req.headers.accept || '').includes('text/html')) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ code: expired ? 'ONPREM_TRIAL_EXPIRED' : 'ONPREM_TRIAL_UNAVAILABLE', contact }));
        return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'");
    res.end('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<title>' + title + ' | QS-VC</title><style>body{margin:0;background:#f0f5f8;color:#142638;font:1rem/1.6 system-ui}'
        + 'main{max-width:35rem;margin:12vh auto;padding:2rem;background:white;border-radius:1rem}h1{line-height:1.2}'
        + 'a{display:inline-block;background:#07585c;color:white;padding:.7rem 1.2rem;border-radius:.5rem}</style>'
        + '<main><p>QS-VC On-prem</p><h1>' + title + '</h1><p>' + message + '</p>'
        + '<a href="' + contact + '">Contact us</a></main></html>');
}).listen(4010, '0.0.0.0');
