const { trialState } = require('./state.cjs');

function refuseStartup() {
    const state = trialState();
    if (state === 'active') return;
    console.error('On-prem trial:', state);
    process.exit(1);
}

refuseStartup();
const timer = setInterval(() => {
    const state = trialState();
    if (state === 'active') return;
    clearInterval(timer);
    console.error('On-prem trial:', state);
    // Let signaling close its connections and the SFU close native media workers.
    setTimeout(() => process.exit(1), 2000).unref();
    process.kill(process.pid, 'SIGTERM');
}, 1000);
timer.unref();
