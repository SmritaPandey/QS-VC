// QS-VC Desktop interface. All server calls go through window.qsvcDesktop (main process).
'use strict';
const api = window.qsvcDesktop;
const root = document.getElementById('root');
const state = { workspace: '', host: '', user: null, version: '', theme: 'system', keepSignedIn: false, view: 'home', scheduled: null, entitlements: { plan: 'guest', status: 'paid_active', trialEndsAt: null, features: [] }, featureMinimumPlans: {}, upgradePrompt: null };

// ── tiny DOM helper (text only, never HTML strings) ──
function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
        if (value === undefined || value === null || value === false) continue;
        if (key === 'class') el.className = value;
        else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
        else if (key === 'text') el.textContent = value;
        else el.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) el.append(child.nodeType ? child : document.createTextNode(String(child)));
    return el;
}
const icon = name => h('span', { class: 'mi', 'aria-hidden': 'true', text: name });
const logo = () => h('img', { src: '../assets/icon.png', alt: '' });

function toast(message, kind = 'info') {
    const box = h('div', { class: `toast ${kind}` }, icon(kind === 'error' ? 'error' : 'check_circle'), h('span', { text: message }));
    document.getElementById('toasts').append(box);
    setTimeout(() => box.remove(), 4200);
}
async function busy(button, label, work) {
    const text = button.textContent; button.disabled = true; button.textContent = label;
    try { return await work(); } finally { button.disabled = false; button.textContent = text; }
}

// ── time helpers ──
const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const timeText = d => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dayText = d => {
    const today = startOfDay(new Date()); const day = startOfDay(d);
    const diff = Math.round((day - today) / 86400000);
    if (diff === 0) return 'Today'; if (diff === 1) return 'Tomorrow'; if (diff === -1) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
};
const greeting = () => { const hour = new Date().getHours(); return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'; };
const initials = name => String(name || '?').replace(/\(.*?\)/g, '').trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?';

// ── screens ──
function render() {
    document.documentElement.dataset.theme = state.theme;
    const screen = !state.workspace ? setupScreen() : !state.user ? (state.personalEnrol ? personalEnrolScreen() : signInScreen()) : shell();
    root.replaceChildren(state.upgradePrompt
        ? h('div', {}, h('div', { class: 'app-surface', inert: true }, screen), upgradeModal())
        : screen);
}

function planName(plan) { return String(plan || 'guest').replace(/_trial$/, ' trial').replace(/^./, letter => letter.toUpperCase()); }
function planBadge() {
    const plan = state.entitlements.plan;
    if (!plan || plan === 'guest') return null;
    const silver = plan === 'starter' || plan === 'starter_trial';
    const tone = silver ? 'silver' : plan === 'enterprise' ? 'violet' : 'gold';
    const crown = plan === 'basic' || plan === 'basic_trial' ? null : h('span', { class: `plan-crown ${tone}`, 'aria-label': `${planName(plan)} plan`, title: `${planName(plan)} plan` }, icon('workspace_premium'));
    let trial = null;
    if (plan.endsWith('_trial') && state.entitlements.trialEndsAt) {
        const days = Math.max(0, Math.ceil((new Date(state.entitlements.trialEndsAt).getTime() - Date.now()) / 86400000));
        trial = h('small', { text: `${days} ${days === 1 ? 'day' : 'days'} left in trial` });
    }
    return h('div', { class: 'plan-status' }, crown, h('div', {}, h('b', { text: planName(plan) }), trial));
}

function upgradeModal() {
    const requirement = typeof state.upgradePrompt === 'string' ? { requiredPlan: state.featureMinimumPlans[state.upgradePrompt] || 'starter' } : state.upgradePrompt;
    const requiredPlan = requirement?.requiredPlan || 'starter';
    const expired = state.entitlements.status === 'trial_expired';
    const pending = state.entitlements.status === 'enterprise_pending';
    const rejected = state.entitlements.status === 'enterprise_rejected';
    const close = () => { state.upgradePrompt = null; state.view = 'home'; render(); };
    const dialog = h('section', { class: 'upgrade-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'upgrade-title', 'aria-describedby': 'upgrade-copy', tabindex: '-1', onkeydown: event => {
        if (event.key === 'Escape' && !expired) { event.preventDefault(); close(); }
        if (event.key === 'Tab') {
            const items = [...event.currentTarget.querySelectorAll('button:not([disabled])')];
            if (!items.length) return;
            if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1).focus(); }
            else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0].focus(); }
        }
    } },
        !expired && h('button', { class: 'upgrade-close', type: 'button', 'aria-label': 'Close plan prompt', onclick: close }, '×'),
        h('span', { class: 'upgrade-icon mi', 'aria-hidden': 'true', text: expired ? 'hourglass_disabled' : 'lock' }),
        h('h2', { id: 'upgrade-title', text: expired ? 'Your Starter trial has ended' : pending ? 'Enterprise access pending' : rejected ? 'Enterprise access not approved' : `Available on ${planName(requiredPlan)}` }),
        h('p', { id: 'upgrade-copy', text: expired ? 'Choose a plan to keep using your meetings workspace.' : pending ? 'Your Enterprise request is waiting for administrator approval.' : rejected ? 'Contact your organisation administrator to discuss Enterprise access.' : `Choose a plan to use ${requirement?.featureLabel || 'this feature'}.` }),
        pending || rejected
            ? h('button', { class: 'upgrade-secondary', type: 'button', onclick: close }, 'Back to meetings')
            : expired
                ? h('div', { class: 'upgrade-plans' },
                    ...['starter', 'pro'].map(plan => h('button', { class: `upgrade-plan ${plan === 'pro' ? 'upgrade-plan-pro' : ''}`, type: 'button', onclick: () => void api.openPlans(plan) },
                        h('b', {}, plan === 'pro' && icon('workspace_premium'), planName(plan)), h('span', { text: plan === 'pro' ? 'Advanced capabilities' : 'Core tools for your team' }), h('strong', { text: 'View plan' }))))
                : h('div', { class: 'upgrade-actions' },
                    h('button', { class: 'btn', type: 'button', onclick: () => void api.openPlans(requiredPlan) }, `View ${planName(requiredPlan)} plan`),
                    h('button', { class: 'upgrade-secondary', type: 'button', onclick: close }, 'Maybe later')));
    const backdrop = h('div', { class: 'upgrade-backdrop', role: 'presentation', onmousedown: event => { if (!expired && event.target === event.currentTarget) close(); } }, dialog);
    setTimeout(() => dialog.focus(), 0);
    return backdrop;
}

function brandPanel(title, text) {
    return h('section', { class: 'auth-brand' },
        h('div', { class: 'brand' }, logo(), 'QS-VC'),
        h('div', {}, h('h1', { text: title }), h('p', { text: text }),
            h('ul', { class: 'auth-points' },
                h('li', {}, icon('lan'), 'Runs on your organisation’s own network'),
                h('li', {}, icon('lock'), 'Your session stays in the app, never in a browser'),
                h('li', {}, icon('translate'), 'Captions and languages for every participant'))),
        h('small', { class: 'version', text: `Version ${state.version}` }));
}

function setupScreen() {
    const error = h('p', { class: 'error', role: 'alert' });
    const input = h('input', { class: 'input', id: 'address', type: 'url', placeholder: 'https://meet.your-organisation.example', autocomplete: 'url', spellcheck: 'false', required: true });
    const submit = h('button', { class: 'btn block', type: 'submit' }, 'Connect');
    const form = h('form', { onsubmit: async event => {
        event.preventDefault(); error.textContent = '';
        const result = await busy(submit, 'Checking…', () => api.setWorkspace(input.value.trim()));
        if (!result.ok) { error.textContent = result.error; input.focus(); return; }
        await refresh(); toast('Connected to your organisation.');
    } },
        h('label', { class: 'field' }, h('span', { text: 'Organisation address' }), input),
        h('p', { class: 'hint', text: 'Ask your administrator for this address. Connect to the office network or VPN first.' }),
        error, submit);
    setTimeout(() => input.focus(), 50);
    return h('main', { class: 'auth' },
        brandPanel('Meet inside your organisation.', 'Connect QS-VC to your organisation’s workspace to start, join and schedule meetings.'),
        h('section', { class: 'auth-panel' }, h('div', { class: 'auth-card' },
            h('h2', { text: 'Connect to your organisation' }),
            h('p', { text: 'You only do this once on this computer.' }), form)));
}

function signInScreen() {
    const error = h('p', { class: 'error', role: 'alert' });
    const email = h('input', { class: 'input', id: 'email', type: 'email', autocomplete: 'username', required: true, maxlength: 255 });
    const password = h('input', { class: 'input', id: 'password', type: 'password', autocomplete: 'current-password', maxlength: 128 });
    const passwordField = h('label', { class: 'field' }, h('span', { text: 'Password' }), password);
    const keep = h('input', { type: 'checkbox', checked: state.keepSignedIn });
    const submit = h('button', { class: 'btn block', type: 'submit' }, 'Continue');
    const cancel = h('button', { class: 'btn secondary', type: 'button', onclick: () => void api.cancelOrganisationSignIn() }, 'Cancel browser sign-in');
    const organisation = h('button', { class: 'btn block', type: 'button', onclick: async () => {
        error.textContent = '';
        cancel.hidden = false;
        submit.disabled = true;
        email.disabled = true;
        const result = await busy(organisation, 'Waiting for browser…', () => api.signInWithOrganisation(email.value, keep.checked));
        cancel.hidden = true;
        email.disabled = false;
        submit.disabled = false;
        if (!result.ok) { error.textContent = result.error || 'Organisation sign-in failed.'; return; }
        state.view = 'home';
        await refresh();
    } }, 'Sign in with your organisation');
    const personal = h('div', { class: 'personal-sign-in' });
    personal.hidden = true;
    void api.personalProviders().then(providers => {
        personal.replaceChildren(...providers.map(provider => {
            const label = provider === 'google' ? 'Google' : 'Microsoft';
            const button = h('button', { class: 'btn secondary block', type: 'button', onclick: async () => {
                error.textContent = '';
                cancel.hidden = false;
                email.disabled = submit.disabled = organisation.disabled = true;
                for (const action of personal.querySelectorAll('button')) action.disabled = true;
                const result = await busy(button, 'Waiting for browser…', () => api.signInWithProvider(provider, keep.checked));
                cancel.hidden = true;
                email.disabled = submit.disabled = organisation.disabled = false;
                for (const action of personal.querySelectorAll('button')) action.disabled = false;
                if (!result.ok) { error.textContent = result.error || 'Sign-in could not be completed.'; return; }
                if (result.enrol) { state.personalEnrol = result.enrol; render(); return; }
                state.view = 'home'; await refresh();
            } }, `Continue with ${label}`);
            return button;
        }));
        personal.hidden = !providers.length || !!method?.required;
    }).catch(() => {});
    let method;
    const update = () => {
        passwordField.hidden = !method || method.required;
        password.required = !!method && !method.required;
        organisation.hidden = !method?.available;
        submit.hidden = !!method?.required;
        personal.hidden = !personal.childElementCount || !!method?.required;
        submit.textContent = method ? 'Sign in with password' : 'Continue';
    };
    cancel.hidden = true;
    update();
    email.addEventListener('input', () => { method = undefined; password.value = ''; error.textContent = ''; update(); });
    const form = h('form', { onsubmit: async event => {
        event.preventDefault(); error.textContent = '';
        if (!method) {
            const address = email.value;
            const result = await busy(submit, 'Checking…', () => api.discover(address));
            if (email.value !== address) return;
            if (!result.ok) { error.textContent = result.error || 'Sign-in discovery failed.'; return; }
            method = result;
            update();
            if (result.available) organisation.focus();
            else if (!result.required) password.focus();
            else error.textContent = 'Your organisation requires SSO. Contact your administrator.';
            return;
        }
        if (method.required) return;
        const result = await busy(submit, 'Signing in…', () => api.login(email.value, password.value, keep.checked));
        if (!result.ok) { error.textContent = result.error || 'Sign in failed.'; password.select(); return; }
        password.value = ''; state.view = 'home'; await refresh();
    } },
        h('label', { class: 'field' }, h('span', { text: 'Email' }), email),
        passwordField, h('label', { class: 'check' }, keep, 'Keep me signed in on this computer'),
        error, submit, organisation, personal, cancel);

    const code = h('input', { class: 'input code-input', placeholder: 'Meeting code', 'aria-label': 'Meeting code' });
    const joinButton = h('button', { class: 'btn secondary', type: 'submit' }, 'Join');
    const guest = h('form', { class: 'row', onsubmit: async event => {
        event.preventDefault();
        const result = await busy(joinButton, '…', () => api.joinMeeting(code.value));
        if (!result.ok) toast(result.error, 'error');
    } }, code, joinButton);
    setTimeout(() => email.focus(), 50);
    return h('main', { class: 'auth' },
        brandPanel('One room. Your language.', 'Sign in to see your meetings.'),
        h('section', { class: 'auth-panel' }, h('div', { class: 'auth-card' },
            h('span', { class: 'org-chip' }, icon('apartment'), state.host, h('button', { type: 'button', onclick: changeOrganisation }, 'Change')),
            h('h2', { text: 'Sign in' }),
            h('p', { text: 'Sign in with your personal or organisation account.' }),
            form,
            h('div', { class: 'divider', text: 'or join as a guest' }),
            guest)));
}

function personalEnrolScreen() {
    const enrol = state.personalEnrol;
    const verifying = !!enrol.verification;
    const error = h('p', { class: 'error', role: 'alert' });
    const fields = verifying
        ? [h('p', { text: `Enter the eight-digit code sent to ${enrol.verification}.` }),
            h('label', { class: 'field' }, 'Verification code', h('input', {
                class: 'input', name: 'otp', autocomplete: 'one-time-code', inputmode: 'numeric', pattern: '[0-9]{8}', required: true,
            }))]
        : [
            h('label', { class: 'field' }, 'Your name', h('input', { class: 'input', name: 'displayName', value: enrol.name || '', autocomplete: 'name', maxlength: 100, required: true })),
            h('label', { class: 'field' }, 'Email', h('input', { class: 'input', name: 'email', type: 'email', value: enrol.verifiedEmail || enrol.email || '', readonly: !!enrol.verifiedEmail, autocomplete: 'email', maxlength: 255, required: true })),
            h('label', { class: 'field' }, 'Mobile number with country code', h('input', { class: 'input', name: 'phoneNumber', type: 'tel', autocomplete: 'tel', maxlength: 24, required: true })),
            h('p', {}, 'By creating an account, you agree to our ', h('a', { href: new URL('/terms', state.workspace).href, target: '_blank', rel: 'noreferrer' }, 'Terms'),
                '. Read our ', h('a', { href: new URL('/privacy', state.workspace).href, target: '_blank', rel: 'noreferrer' }, 'Privacy Policy'), '.'),
        ];
    const submit = h('button', { class: 'btn block' }, verifying ? 'Verify and create account' : enrol.verifiedEmail ? 'Create account' : 'Send verification code');
    const form = h('form', { onsubmit: async event => {
        event.preventDefault(); error.textContent = '';
        const input = Object.fromEntries(new FormData(event.currentTarget));
        const result = await busy(submit, 'Please wait…', () => api.completePersonalSignIn(input));
        if (!result.ok) { error.textContent = result.error || 'Sign-in could not be completed.'; return; }
        if (result.verification) { state.personalEnrol = { verification: result.verification }; render(); return; }
        state.personalEnrol = undefined; state.view = 'home'; await refresh();
    } }, fields, error, submit, h('button', { class: 'btn secondary block', type: 'button', onclick: () => {
        void api.cancelPersonalSignIn(); state.personalEnrol = undefined; render();
    } }, 'Back to sign in'));
    return h('main', { class: 'auth' },
        brandPanel('One room. Your language.', 'Sign in to see your meetings.'),
        h('section', { class: 'auth-panel' }, h('div', { class: 'auth-card' }, h('h2', { text: verifying ? 'Check your email' : 'Finish creating your account' }), form)));
}

function shell() {
    const scheduleLocked = !state.entitlements.features.includes('meeting_scheduling');
    const nav = (view, label, name) => h('button', { class: 'nav', 'aria-current': state.view === view ? 'page' : false, onclick: () => {
        state.view = view; state.scheduled = null;
        if (view === 'schedule' && scheduleLocked) state.upgradePrompt = 'meeting_scheduling';
        render();
    } }, icon(name), label, view === 'schedule' && scheduleLocked ? h('span', { class: 'nav-lock mi', 'aria-label': 'Plan required' }, 'lock') : null);
    const views = { home: homeView, meetings: meetingsView, schedule: scheduleView, settings: settingsView };
    return h('div', { class: 'shell' },
        h('aside', { class: 'sidebar' },
            h('div', { class: 'brand' }, logo(), 'QS-VC'),
            planBadge(),
            nav('home', 'Home', 'home'), nav('meetings', 'Meetings', 'calendar_month'), nav('schedule', 'Schedule', 'event'), nav('settings', 'Settings', 'settings'),
            h('div', { class: 'sidebar-foot' },
                h('div', { class: 'org', title: state.workspace }, h('span', { class: 'dot' }), h('span', { text: state.host })),
                h('div', { class: 'me' },
                    h('span', { class: 'avatar', text: initials(state.user.displayName) }),
                    h('div', { class: 'me-text' }, h('b', { text: state.user.displayName }),
                        state.user.role === 'admin' ? h('span', { class: 'badge' }, 'Admin') : h('small', { text: state.user.email }))))),
        h('main', { class: 'main' }, views[state.view]()));
}

// Home: three quick actions and what's coming up.
function homeView() {
    const first = String(state.user.displayName).split(/\s+/)[0];
    const code = h('input', { class: 'input', placeholder: 'QS-XXXX-XXXX-XXXX', 'aria-label': 'Meeting code', onclick: e => e.stopPropagation() });
    const joinBtn = h('button', { class: 'btn small', type: 'submit' }, 'Join');
    const list = h('div', { class: 'list' }, h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }));
    void loadMeetings(list, 0, 7, true);
    return h('div', { class: 'page' },
        h('header', { class: 'page-head' }, h('div', {},
            h('h1', { text: `${greeting()}, ${first}` }),
            h('p', { text: new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) }))),
        h('section', { class: 'actions', 'aria-label': 'Quick actions' },
            h('button', { class: 'action primary', onclick: e => startNow(e.currentTarget) },
                h('span', { class: 'ico' }, icon('video_call')), h('b', { text: 'New meeting' }), h('small', { text: 'Start now and invite people' })),
            h('div', { class: 'action', role: 'group', 'aria-label': 'Join with a code' },
                h('span', { class: 'ico' }, icon('keyboard')), h('b', { text: 'Join with a code' }),
                h('form', { class: 'join-inline', onsubmit: async event => {
                    event.preventDefault();
                    const result = await busy(joinBtn, '…', () => api.joinMeeting(code.value));
                    if (!result.ok) toast(result.error, 'error');
                } }, code, joinBtn)),
            h('button', { class: 'action', onclick: () => { state.view = 'schedule'; render(); } },
                h('span', { class: 'ico' }, icon('event')), h('b', { text: 'Schedule' }), h('small', { text: 'Plan a meeting and share the invite' }))),
        h('div', { class: 'section-title' }, h('h2', { text: 'Coming up' }),
            h('button', { class: 'btn ghost small', onclick: () => { state.view = 'meetings'; render(); } }, 'All meetings', icon('arrow_forward'))),
        list);
}

function meetingsView() {
    const list = h('div', { class: 'list' }, h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }));
    void loadMeetings(list, -7, 21, false);
    return h('div', { class: 'page' },
        h('header', { class: 'page-head' },
            h('div', {}, h('h1', { text: 'Meetings' }), h('p', { text: 'Your organisation’s meetings from last week to three weeks ahead.' })),
            h('button', { class: 'btn', onclick: () => { state.view = 'schedule'; render(); } }, icon('add'), 'Schedule')),
        list);
}

async function loadMeetings(container, fromDays, toDays, upcomingOnly) {
    const start = addDays(startOfDay(new Date()), fromDays);
    const result = await api.listMeetings(start.toISOString(), addDays(start, Math.min(31, toDays - fromDays)).toISOString());
    if (!result.ok) { container.replaceChildren(h('div', { class: 'empty' }, icon('cloud_off'), h('b', { text: 'Meetings could not load' }), h('span', { text: result.error || '' }))); return; }
    const now = Date.now();
    let meetings = result.meetings.filter(m => m.status !== 'ended' && m.status !== 'cancelled').map(m => ({ ...m, when: new Date(m.scheduledStart || m.createdAt) }));
    if (upcomingOnly) meetings = meetings.filter(m => m.when.getTime() > now - 3 * 3600000).slice(0, 8);
    meetings.sort((a, b) => a.when - b.when);
    if (!meetings.length) {
        container.replaceChildren(h('div', { class: 'empty' }, icon('event_available'), h('b', { text: 'Nothing scheduled' }), h('span', { text: 'Start a meeting now or schedule one for later.' })));
        return;
    }
    const nodes = []; let lastDay = '';
    for (const meeting of meetings) {
        const day = dayText(meeting.when);
        if (!upcomingOnly && day !== lastDay) { nodes.push(h('div', { class: 'day', text: day })); lastDay = day; }
        nodes.push(meetingRow(meeting, upcomingOnly));
    }
    container.replaceChildren(...nodes);
}

function meetingRow(meeting, withDay) {
    const join = h('button', { class: 'btn small', onclick: async () => { const r = await busy(join, '…', () => api.joinMeeting(meeting.meetingCode)); if (!r.ok) toast(r.error, 'error'); } }, 'Join');
    const active = meeting.status === 'active';
    const canManage = active ? meeting.isHost : meeting.status === 'waiting' && (meeting.scheduledStart ? meeting.canCancel : meeting.isHost);
    const manage = canManage ? h('button', { type: 'button', class: 'btn danger small',
        'aria-label': `${active ? 'End meeting for everyone' : 'Cancel meeting'}: ${meeting.title || meeting.meetingCode}`,
        onclick: async () => {
            const buttons = row.querySelectorAll('button');
            buttons.forEach(button => { button.disabled = true; });
            manage.textContent = active ? 'Ending…' : 'Cancelling…';
            try {
                const result = await api.changeMeeting({ id: meeting.id, meetingCode: meeting.meetingCode, title: meeting.title,
                    action: active ? 'end' : 'cancel', scheduled: !!meeting.scheduledStart });
                if (!result.ok) { toast(result.error || 'Could not update this meeting. Try again.', 'error'); return; }
                if (!result.dismissed) { toast(active ? 'Meeting ended for everyone.' : 'Meeting cancelled.'); render(); }
            } catch { toast('Could not update this meeting. Check its status and try again.', 'error'); }
            finally {
                buttons.forEach(button => { button.disabled = false; });
                manage.textContent = active ? 'End meeting' : 'Cancel meeting';
            }
        } }, active ? 'End meeting' : 'Cancel meeting') : null;
    const row = h('article', { class: 'meeting' },
        h('time', { datetime: meeting.when.toISOString() }, timeText(meeting.when), h('small', { text: withDay ? dayText(meeting.when) : (meeting.type === 'instant' ? 'Instant' : 'Scheduled') })),
        h('div', { class: 'title' }, h('b', {}, meeting.title || 'Meeting', meeting.status === 'active' ? h('span', { class: 'live', text: 'Live' }) : null), h('code', { text: meeting.meetingCode })),
        h('div', { class: 'tools' },
            manage,
            h('button', { class: 'icon-btn', title: 'Copy invitation', 'aria-label': `Copy invitation for ${meeting.title || 'meeting'}`, onclick: async () => { const r = await api.copyInvite(meeting.meetingCode); toast(r.ok ? 'Invitation copied.' : 'Could not copy.', r.ok ? 'info' : 'error'); } }, icon('content_copy')),
            join));
    return row;
}

async function startNow(button) {
    const result = await busy(button, 'Starting…', () => api.createMeeting(`${String(state.user.displayName).split(/\s+/)[0]}’s meeting`));
    if (!result.ok) { toast(result.error, 'error'); return; }
    await api.copyInvite(result.meeting.meetingCode);
    toast('Invitation copied — paste it to invite people.');
    const join = await api.joinMeeting(result.meeting.meetingCode);
    if (!join.ok) toast(join.error, 'error');
}

function scheduleView() {
    if (state.scheduled) {
        const meeting = state.scheduled;
        const when = new Date(meeting.scheduledStart);
        return h('div', { class: 'page' }, h('section', { class: 'card done' },
            h('span', { class: 'ok' }, icon('event_available')),
            h('h1', { class: 'done-title', text: 'Meeting scheduled' }),
            h('p', { class: 'done-sub', text: `${meeting.title} · ${dayText(when)}, ${timeText(when)}` }),
            h('div', { class: 'code-box' }, meeting.meetingCode),
            h('div', { class: 'row done-actions' },
                h('button', { class: 'btn', onclick: async () => { const r = await api.copyInvite(meeting.meetingCode); toast(r.ok ? 'Invitation copied.' : 'Could not copy.', r.ok ? 'info' : 'error'); } }, icon('content_copy'), 'Copy invitation'),
                h('button', { class: 'btn secondary', onclick: () => { state.scheduled = null; render(); } }, 'Schedule another'),
                h('button', { class: 'btn ghost', onclick: () => { state.view = 'home'; state.scheduled = null; render(); } }, 'Back to home'))));
    }
    const next = new Date(); next.setDate(next.getDate() + 1); next.setHours(10, 0, 0, 0);
    const pad = n => String(n).padStart(2, '0');
    const title = h('input', { class: 'input', id: 'title', maxlength: 200, placeholder: 'Weekly team call', required: true });
    const date = h('input', { class: 'input', type: 'date', id: 'date', value: `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`, required: true });
    const time = h('input', { class: 'input', type: 'time', id: 'time', value: '10:00', required: true });
    const minutes = h('select', { class: 'input', id: 'minutes' }, ...[[15, '15 minutes'], [30, '30 minutes'], [45, '45 minutes'], [60, '1 hour'], [90, '1.5 hours'], [120, '2 hours']].map(([v, l]) => h('option', { value: v, selected: v === 60, text: l })));
    const error = h('p', { class: 'error', role: 'alert' });
    const submit = h('button', { class: 'btn', type: 'submit' }, icon('event'), 'Schedule meeting');
    setTimeout(() => title.focus(), 50);
    return h('div', { class: 'page' },
        h('header', { class: 'page-head' }, h('div', {}, h('h1', { text: 'Schedule a meeting' }), h('p', { text: 'Pick a time; you’ll get a code and an invitation to share.' }))),
        h('form', { class: 'card form-card', onsubmit: async event => {
            event.preventDefault(); error.textContent = '';
            const start = new Date(`${date.value}T${time.value}`);
            if (!title.value.trim()) { error.textContent = 'Give the meeting a title.'; title.focus(); return; }
            if (Number.isNaN(start.getTime()) || start.getTime() < Date.now() - 60000) { error.textContent = 'Choose a time in the future.'; return; }
            const result = await busy(submit, 'Scheduling…', () => api.scheduleMeeting({ title: title.value.trim(), start: start.toISOString(), minutes: Number(minutes.value) }));
            if (!result.ok) { error.textContent = result.error; return; }
            state.scheduled = result.meeting; render();
        } },
            h('label', { class: 'field' }, h('span', { text: 'Title' }), title),
            h('div', { class: 'grid-2' }, h('label', { class: 'field' }, h('span', { text: 'Date' }), date), h('label', { class: 'field' }, h('span', { text: 'Start time' }), time)),
            h('label', { class: 'field' }, h('span', { text: 'Duration' }), minutes),
            error, submit));
}

function settingsView() {
    const themeButton = (value, label, name) => h('button', { 'aria-pressed': String(state.theme === value), onclick: async () => { await api.setTheme(value); state.theme = value; render(); } }, icon(name), label);
    const keep = h('button', { class: 'switch', role: 'switch', 'aria-checked': String(state.keepSignedIn), 'aria-label': 'Keep me signed in', onclick: async () => { state.keepSignedIn = !state.keepSignedIn; await api.setKeepSignedIn(state.keepSignedIn); render(); } });
    return h('div', { class: 'page' },
        h('header', { class: 'page-head' }, h('div', {}, h('h1', { text: 'Settings' }))),
        h('div', { class: 'settings' },
            h('section', { class: 'card' }, h('h2', { text: 'Account' }), h('p', { text: 'You are signed in to your organisation.' }),
                h('div', { class: 'setting' },
                    h('div', { class: 'row' }, h('span', { class: 'avatar', text: initials(state.user.displayName) }),
                        h('div', {}, h('b', {}, state.user.displayName, ' ', state.user.role === 'admin' ? h('span', { class: 'badge' }, 'Admin') : null), h('small', { text: state.user.email }))),
                    h('button', { class: 'btn danger small', onclick: signOut }, icon('logout'), 'Sign out')),
                h('div', { class: 'setting spaced' },
                    h('div', {}, h('b', { text: 'Keep me signed in' }), h('small', { text: 'Stored encrypted in this computer’s keychain.' })), keep)),
            h('section', { class: 'card' }, h('h2', { text: 'Appearance' }), h('p', { text: 'Applies to the app and your meetings.' }),
                h('div', { class: 'segmented', role: 'group', 'aria-label': 'Theme' }, themeButton('system', 'System', 'computer'), themeButton('light', 'Light', 'light_mode'), themeButton('dark', 'Dark', 'dark_mode'))),
            h('section', { class: 'card' }, h('h2', { text: 'Organisation' }),
                h('div', { class: 'setting' }, h('div', {}, h('b', { text: state.host }), h('small', { text: state.workspace })),
                    h('button', { class: 'btn secondary small', onclick: changeOrganisation }, 'Change'))),
            h('section', { class: 'card' }, h('h2', { text: 'About' }),
                h('div', { class: 'setting' }, h('div', {}, h('b', { text: `QS-VC ${state.version}` }), h('small', { text: 'Camera, microphone and screen sharing are only allowed for your organisation’s meetings.' }))))));
}

async function signOut() { await api.logout(); state.user = null; state.view = 'home'; toast('Signed out.'); render(); }
async function changeOrganisation() {
    if (state.user) await api.logout();
    state.user = null; state.workspace = ''; state.host = ''; render();
}

async function refresh() {
    Object.assign(state, await api.state());
    if (state.user && state.entitlements.status === 'trial_expired') state.upgradePrompt = { requiredPlan: 'starter', trialEnded: true };
    else if (state.entitlements.status !== 'trial_expired' && state.upgradePrompt?.trialEnded) state.upgradePrompt = null;
    render();
}

api.onEvent((event, payload) => {
    if (event === 'session-expired') { state.user = null; toast('Your session ended. Sign in again.', 'error'); render(); }
    if (event === 'upgrade-required' && state.user && state.entitlements.status !== 'trial_expired') {
        state.upgradePrompt = { requiredPlan: payload?.requiredPlan || 'starter' };
        render();
    }
});
window.addEventListener('online', () => void refresh());
window.addEventListener('focus', () => { if (state.user) void refresh(); });
const notice = new URLSearchParams(location.search).get('notice');
refresh().then(() => { if (notice) toast(notice); });
