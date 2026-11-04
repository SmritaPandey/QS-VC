const { readFileSync } = require('node:fs');

function scopeErrors(scope, now = Date.now()) {
    if (!scope || typeof scope !== 'object') return ['Scope must be a JSON object.'];
    const errors = [];
    if (scope.environment !== 'staging') errors.push('This preflight only covers staging.');
    let target;
    try { if (typeof scope.target === 'string') target = new URL(scope.target); } catch { /* Report invalid URL below. */ }
    const production = ['qsvcmeet.com', 'www.qsvcmeet.com', 'backend.qsvcmeet.com'];
    if (!target || target.protocol !== 'https:' || target.username || target.password ||
        target.search || target.hash || production.includes(target.hostname.replace(/\.$/, ''))) {
        errors.push('Provide an exact staging HTTPS URL without credentials, query or fragment.');
    }
    if (typeof scope.approvalReference !== 'string' || !scope.approvalReference.trim()) {
        errors.push('Record the owner’s approval reference.');
    }
    const timestamp = value => typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)
        ? Date.parse(value) : NaN;
    const start = timestamp(scope.startsAt);
    const end = timestamp(scope.endsAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        errors.push('Provide ordered start and end timestamps with explicit time zone offsets.');
    } else if (now < start || now >= end) {
        errors.push('The approved window is not currently open.');
    }
    if (!Array.isArray(scope.methods) || !scope.methods.length ||
        scope.methods.some(method => !['burp-passive', 'burp-manual'].includes(method))) {
        errors.push('This preflight only covers Burp passive inspection and manual replay.');
    }
    if (!Number.isInteger(scope.maxRequestsPerMinute) || scope.maxRequestsPerMinute < 1 ||
        scope.maxRequestsPerMinute > 30 || scope.maxConcurrency !== 1) {
        errors.push('Use 1–30 requests per minute and one request at a time.');
    }
    return errors;
}

if (require.main === module) {
    try {
        const errors = scopeErrors(JSON.parse(readFileSync(process.argv[2], 'utf8')));
        if (errors.length) throw new Error(errors.join('\n'));
        console.log('Scope fields passed. Verify the recorded approval and apply the limits in the tool.');
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
module.exports = { scopeErrors };
