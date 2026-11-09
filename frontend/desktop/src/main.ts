/**
 * QS-VC Desktop — Electron main process.
 *
 * The app has its own interface (static/app.html): organisation setup, sign-in, home with
 * meetings, schedule and settings. It talks to the organisation's QS-VC server from this
 * process (no browser CORS, the session token never touches page storage). Only a meeting
 * itself opens the server's meeting room page; leaving the meeting returns to the app.
 *
 * Organisation address: first-run screen, or IT pre-sets `workspace.json` next to QS-VC.exe
 * ({"workspaceUrl":"https://..."}), or QSVC_WEB_URL.
 */
import { app, BrowserWindow, Tray, Menu, nativeImage, Notification, ipcMain, shell, session, desktopCapturer, dialog, net, nativeTheme, safeStorage, clipboard } from 'electron';
import * as fs from 'fs';
import { randomBytes } from 'node:crypto';
import { createSsoLoopback } from './sso-loopback';
import * as path from 'path';
// Copied into the app package at build time (scripts/vendor-shared.cjs): the packaged app must never
// load files from outside its own folder, or it fails to start.
import { FEATURE_MIN_PLAN } from './vendor/entitlements.cjs';

const PROTOCOL = 'qsvc';
const MEETING_CODE = /^[A-Z0-9]{2,8}(-[A-Z0-9]{2,8}){1,4}$/;
const APP_PAGE = path.join(__dirname, '..', 'static', 'app.html');

type Theme = 'system' | 'light' | 'dark';
interface EntitlementSnapshot { plan: string; status: string; trialEndsAt: string | null; features: string[] }
interface Config { workspaceUrl?: string; theme?: Theme; keepSignedIn?: boolean; activationReportedWorkspaces?: string[]; entitlementsCache?: { workspaceOrigin: string; accountId: string; fetchedAt: string; value: EntitlementSnapshot } }
interface User { id: string; email: string; displayName: string; role: string; tenantId?: string }

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let workspace: URL | null = null;
let token = '';
let user: User | null = null;
let meetingMarker = '';           // non-secret placeholder for meeting web requests
let cancelSso: (() => void) | undefined;
let pendingDeepLink = '';

// ━━━ Settings on disk ━━━

const file = (name: string) => path.join(app.getPath('userData'), name);
function readConfig(): Config { try { return JSON.parse(fs.readFileSync(file('config.json'), 'utf8')); } catch { return {}; } }
function writeConfig(patch: Partial<Config>) {
    const next = { ...readConfig(), ...patch };
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(file('config.json'), JSON.stringify(next, null, 2), { mode: 0o600 });
}

function parseWorkspace(value: unknown): URL | null {
    try {
        const url = new URL(String(value).trim());
        const localDev = !app.isPackaged && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
        if ((url.protocol !== 'https:' && !localDev) || url.username || url.password || url.search || url.hash) return null;
        url.pathname = url.pathname.replace(/\/+$/, '') + '/';
        return url;
    } catch { return null; }
}

function loadWorkspace(): URL | null {
    const candidates: unknown[] = [process.env.QSVC_WEB_URL, readConfig().workspaceUrl];
    try { candidates.push(JSON.parse(fs.readFileSync(path.join(path.dirname(process.execPath), 'workspace.json'), 'utf8')).workspaceUrl); } catch { /* not pre-set */ }
    for (const value of candidates) { const url = value ? parseWorkspace(value) : null; if (url) return url; }
    return null;
}

// "Keep me signed in": the token is encrypted with the OS keychain (safeStorage) or not kept at all.
function saveSession() {
    try {
        if (readConfig().keepSignedIn && token && safeStorage.isEncryptionAvailable()) fs.writeFileSync(file('session.bin'), safeStorage.encryptString(token), { mode: 0o600 });
        else fs.rmSync(file('session.bin'), { force: true });
    } catch { /* never block sign-in on storage */ }
}
function restoreSession() {
    try { if (safeStorage.isEncryptionAvailable()) token = safeStorage.decryptString(fs.readFileSync(file('session.bin'))); } catch { token = ''; }
}
function clearSession() { token = ''; user = null; meetingMarker = ''; cancelSso?.(); try { fs.rmSync(file('session.bin'), { force: true }); } catch { /* ignore */ } }

// ━━━ Server API (from the main process) ━━━

interface ApiResult { ok: boolean; status: number; data: any; error?: string }

async function api(route: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<ApiResult> {
    if (!workspace) return { ok: false, status: 0, data: null, error: 'Set your organisation address first.' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (init.body !== undefined) headers['Content-Type'] = 'application/json';
        if (init.auth !== false && token) headers.Authorization = `Bearer ${token}`;
        const response = await net.fetch(new URL(route.replace(/^\//, ''), workspace).href, {
            method: init.method || 'GET', headers, signal: controller.signal, cache: 'no-store',
            body: init.body === undefined ? undefined : JSON.stringify(init.body),
        });
        const text = await response.text();
        let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = null; }
        if (response.status === 401 && init.auth !== false && token) { clearSession(); notifyRenderer('session-expired'); }
        const error = response.ok ? undefined
            : response.status === 429 ? 'Too many attempts. Wait a few minutes and try again.'
            : (data && typeof data.error === 'string' ? data.error : `The server answered ${response.status}.`);
        if (response.status === 403 && data?.code === 'UPGRADE_REQUIRED' && typeof data.requiredPlan === 'string') {
            notifyRenderer('upgrade-required', { requiredPlan: data.requiredPlan });
        }
        return { ok: response.ok, status: response.status, data, error };
    } catch {
        return { ok: false, status: 0, data: null, error: 'Cannot reach your organisation. Check the office network or VPN.' };
    } finally { clearTimeout(timer); }
}

const activationRequests = new Set<string>();
async function reportDesktopActivation() {
    if (!workspace || !token) return;
    const workspaceKey = workspace.origin;
    const reported = readConfig().activationReportedWorkspaces || [];
    if (reported.includes(workspaceKey) || activationRequests.has(workspaceKey)) return;
    activationRequests.add(workspaceKey);
    try {
        const result = await api('api/auth/enterprise/activation', {
            method: 'POST',
            body: { platform: process.platform, architecture: process.arch, appVersion: app.getVersion() },
        });
        if (result.ok) {
            const current = readConfig().activationReportedWorkspaces || [];
            writeConfig({ activationReportedWorkspaces: [...new Set([...current, workspaceKey])] });
        }
    } finally {
        activationRequests.delete(workspaceKey);
    }
}

async function reachable(url: URL): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
        // Any HTTP answer (a redirect or sign-in page too) proves the address is reachable.
        const response = await net.fetch(url.href, { method: 'GET', signal: controller.signal, redirect: 'follow', cache: 'no-store' });
        void response.body?.cancel();
        return response.status > 0;
    } catch { return false; } finally { clearTimeout(timer); }
}

const cleanUser = (value: any): User | null => value && typeof value.email === 'string'
    ? { id: String(value.id), email: value.email, displayName: String(value.displayName || value.email), role: String(value.role || 'member'), tenantId: value.tenantId }
    : null;

// ━━━ Window and navigation ━━━

function sameOrigin(value: string): boolean {
    try { return !!workspace && new URL(value).origin === workspace.origin; } catch { return false; }
}
function isAppPage(url: string | undefined): boolean {
    try { return !!url && new URL(url).protocol === 'file:' && decodeURIComponent(new URL(url).pathname).endsWith('/static/app.html'); } catch { return false; }
}
function inMeeting(url: string): boolean {
    try { return sameOrigin(url) && /^\/meeting\/[^/]+(\/preview)?\/?$/.test(new URL(url).pathname); } catch { return false; }
}

function showApp(notice = '') {
    if (!mainWindow) return;
    void mainWindow.loadFile(APP_PAGE, notice ? { query: { notice } } : undefined);
}

function openMeeting(code: string) {
    if (!mainWindow || !workspace) return;
    meetingMarker = token ? `qsvc-desktop-${randomBytes(16).toString('hex')}` : '';
    void mainWindow.loadURL(new URL(`meeting/${encodeURIComponent(code)}/preview`, workspace).href);
}

function notifyRenderer(event: string, payload?: unknown) {
    if (mainWindow && isAppPage(mainWindow.webContents.getURL())) mainWindow.webContents.send('app:event', event, payload);
}

function createMainWindow(): BrowserWindow {
    const win = new BrowserWindow({
        width: 1200, height: 780, minWidth: 900, minHeight: 600,
        backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b1420' : '#f5f8fa',
        title: 'QS-VC',
        icon: path.join(__dirname, '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
        autoHideMenuBar: true,
        webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
        show: false,
    });
    win.once('ready-to-show', () => { win.show(); win.focus(); });
    win.on('close', event => { if (!quitting && process.platform !== 'darwin' && tray) { event.preventDefault(); win.hide(); } });

    const openOutside = (url: string) => { if (/^https:\/\//i.test(url)) void shell.openExternal(url); };
    win.webContents.setWindowOpenHandler(({ url }) => { openOutside(url); return { action: 'deny' }; });
    // Only the meeting room is shown from the server; any other server page returns to the app.
    win.webContents.on('will-navigate', (event, url) => {
        if (isAppPage(url) || inMeeting(url)) return;
        event.preventDefault();
        if (sameOrigin(url)) showApp('You left the meeting.'); else openOutside(url);
    });
    const guard = (url: string) => { if (sameOrigin(url) && !inMeeting(url)) showApp('You left the meeting.'); };
    win.webContents.on('did-navigate', (_event, url) => guard(url));
    win.webContents.on('did-navigate-in-page', (_event, url) => guard(url));
    win.webContents.on('did-fail-load', (_event, code, _description, url, isMainFrame) => {
        if (isMainFrame && code !== -3 && inMeeting(url)) showApp('Could not open the meeting. Check the office network or VPN.');
    });

    void win.loadFile(APP_PAGE);
    return win;
}

// ━━━ Media permissions and screen sharing (meeting room only) ━━━

function setupPermissions() {
    session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['*://*/api/*'] }, (details, done) => {
        const headers = details.requestHeaders;
        if (token && meetingMarker && details.webContentsId === mainWindow?.webContents.id
            && details.frame === mainWindow?.webContents.mainFrame && inMeeting(details.frame?.url || '') && sameOrigin(details.url)) {
            const name = Object.keys(headers).find(key => key.toLowerCase() === 'authorization');
            if (name && headers[name] === `Bearer ${meetingMarker}`) headers[name] = `Bearer ${token}`;
        }
        done({ requestHeaders: headers });
    });
    const allowed = new Set(['media', 'display-capture', 'notifications', 'fullscreen', 'clipboard-sanitized-write']);
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => callback(allowed.has(permission) && sameOrigin(webContents.getURL())));
    session.defaultSession.setPermissionCheckHandler((_webContents, permission, origin) => allowed.has(permission) && sameOrigin(origin));
    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
        if (!sameOrigin(request.securityOrigin || request.frame?.url || '')) { callback({}); return; }
        try {
            const sources = (await desktopCapturer.getSources({ types: ['screen', 'window'] })).slice(0, 8);
            if (!sources.length || !mainWindow) { callback({}); return; }
            const { response } = await dialog.showMessageBox(mainWindow, {
                type: 'question', title: 'Share your screen', message: 'Choose what to share',
                buttons: [...sources.map(source => source.name.slice(0, 60) || 'Screen'), 'Cancel'], cancelId: sources.length, defaultId: 0, noLink: true,
            });
            callback(response < sources.length ? { video: sources[response] } : {});
        } catch { callback({}); }
    });
}

// ━━━ Tray ━━━

function createTray(): Tray {
    const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.png')).resize({ width: 16, height: 16 });
    const instance = new Tray(icon);
    const show = () => { mainWindow?.show(); mainWindow?.focus(); };
    instance.setToolTip('QS-VC');
    instance.setContextMenu(Menu.buildFromTemplate([
        { label: 'Open QS-VC', click: show },
        { label: 'Home', click: () => { show(); showApp(); } },
        { type: 'separator' },
        { label: 'Quit QS-VC', click: () => { quitting = true; app.quit(); } },
    ]));
    instance.on('double-click', show);
    return instance;
}

// ━━━ IPC: the app page only ━━━

function appHandler<T extends unknown[]>(channel: string, fn: (...args: T) => unknown) {
    ipcMain.handle(channel, (event, ...args) => {
        if (!isAppPage(event.senderFrame?.url)) throw new Error('Not allowed');
        return fn(...(args as T));
    });
}

function setupIPC() {
    appHandler('app:state', async () => {
        if (workspace && token && !user) {
            const me = await api('api/auth/me');
            user = me.ok ? cleanUser(me.data) : null;
            if (!me.ok && me.status !== 0) clearSession();
        }
        if (user) void reportDesktopActivation();
        let entitlements: EntitlementSnapshot = { plan: 'guest', status: 'paid_active', trialEndsAt: null, features: [] };
        if (workspace && user && token) {
            const result = await api('api/auth/me/entitlements');
            if (result.ok && ['guest', 'starter_trial', 'starter', 'pro_trial', 'pro', 'enterprise'].includes(result.data?.plan)
                && Array.isArray(result.data?.features)) {
                entitlements = {
                    plan: result.data.plan,
                    status: String(result.data.status || 'paid_active'),
                    trialEndsAt: typeof result.data.trialEndsAt === 'string' ? result.data.trialEndsAt : null,
                    features: result.data.features.filter((feature: unknown): feature is string => typeof feature === 'string'),
                };
                writeConfig({ entitlementsCache: { workspaceOrigin: workspace.origin, accountId: user.id, fetchedAt: new Date().toISOString(), value: entitlements } });
            } else {
                const cached = readConfig().entitlementsCache;
                if (cached?.workspaceOrigin === workspace.origin && cached.accountId === user.id) entitlements = cached.value;
            }
        }
        const config = readConfig();
        return { workspace: workspace?.href || '', host: workspace?.host || '', user, entitlements, featureMinimumPlans: FEATURE_MIN_PLAN, version: app.getVersion(), theme: config.theme || 'system', keepSignedIn: !!config.keepSignedIn, platform: process.platform };
    });

    appHandler('workspace:set', async (value: unknown) => {
        const url = parseWorkspace(value);
        if (!url) return { ok: false, error: 'Enter a full secure address that starts with https://' };
        if (!(await reachable(url))) return { ok: false, error: 'Cannot reach that address. Connect to your office network or VPN and try again.' };
        if (workspace && url.origin !== workspace.origin) clearSession();
        workspace = url;
        writeConfig({ workspaceUrl: url.href });
        return { ok: true };
    });

    appHandler('auth:discover', async (email: unknown) => {
        const result = await api('api/auth/sso/discover', { method: 'POST', auth: false, body: { email: String(email || '').trim() } });
        // Older workspaces still support password sign-in.
        if (result.status === 404) return { ok: true, available: false, required: false };
        return result.ok ? { ok: true, available: !!result.data?.available, required: !!result.data?.required }
            : { ok: false, error: result.error };
    });

    let pendingPersonal: { origin: string; code: string; verifier: string; keep: boolean; verifying: boolean } | undefined;
    function finishSignIn(data: any, keep: boolean) {
        const profile = cleanUser(data?.user);
        if (!profile || typeof data?.token !== 'string') return { ok: false, error: 'Sign-in could not be completed.' };
        token = data.token;
        user = profile;
        writeConfig({ keepSignedIn: keep });
        saveSession();
        void reportDesktopActivation();
        return { ok: true, user };
    }

    async function browserSignIn(identity: string, keep: boolean, personal = false) {
        if (!workspace || cancelSso) return { ok: false, error: 'A browser sign-in is already in progress or the workspace is unavailable.' };
        pendingPersonal = undefined;
        const origin = workspace.origin;
        const base = personal ? 'api/auth/sso/personal' : 'api/auth/sso';
        let loopback: Awaited<ReturnType<typeof createSsoLoopback>> | undefined;
        let cancelled = false;
        cancelSso = () => { cancelled = true; loopback?.close(); };
        try {
            loopback = await createSsoLoopback();
            if (cancelled) return { ok: false, error: 'Sign-in was cancelled.' };
            const start = await api(`${base}/start`, { method: 'POST', auth: false, body: {
                ...(personal ? { provider: identity } : { email: identity }), challenge: loopback.challenge, desktop: { port: loopback.port, path: loopback.path },
            } });
            if (!start.ok || cancelled) return { ok: false, error: start.error || 'Sign-in was cancelled.' };
            const url = new URL(start.data.url);
            if (url.origin !== origin || url.pathname !== `/${base}/start` || url.username || url.password) {
                throw new Error('Invalid workspace sign-in URL');
            }
            await shell.openExternal(url.href);
            const code = await loopback.result;
            if (!code || cancelled || workspace?.origin !== origin) return { ok: false, error: 'Sign-in was cancelled or expired.' };
            const signedIn = await api(`${base}/exchange`, { method: 'POST', auth: false, body: { code, verifier: loopback.verifier } });
            if (!signedIn.ok || cancelled || workspace?.origin !== origin) {
                return { ok: false, error: signedIn.error || 'Sign-in could not be completed.' };
            }
            if (personal && typeof signedIn.data?.enrol?.code === 'string') {
                const { code, name, email, verifiedEmail } = signedIn.data.enrol;
                pendingPersonal = { origin, code, verifier: loopback.verifier, keep, verifying: false };
                return { ok: true, enrol: { name, email, verifiedEmail } };
            }
            return finishSignIn(signedIn.data, keep);
        } catch { return { ok: false, error: 'Could not start browser sign-in.' }; }
        finally { loopback?.close(); cancelSso = undefined; }
    }

    appHandler('auth:sso', (email: unknown, keep: unknown) => browserSignIn(String(email || '').trim(), keep === true));
    appHandler('auth:personal-providers', async () => {
        const result = await api('api/auth/sso/personal/providers', { auth: false });
        return Array.isArray(result.data?.providers) ? result.data.providers.filter((provider: unknown) => provider === 'google' || provider === 'microsoft') : [];
    });
    appHandler('auth:personal', (provider: unknown, keep: unknown) => provider === 'google' || provider === 'microsoft'
        ? browserSignIn(provider, keep === true, true) : { ok: false, error: 'Unknown sign-in provider.' });
    appHandler('auth:personal-cancel', () => { pendingPersonal = undefined; });
    appHandler('auth:personal-complete', async (input: Record<string, unknown>) => {
        const pending = pendingPersonal;
        if (!pending || pending.origin !== workspace?.origin) return { ok: false, error: 'Start sign-in again.' };
        const body = pending.verifying ? { otp: String(input?.otp || '') }
            : { email: String(input?.email || ''), displayName: String(input?.displayName || ''), phoneNumber: String(input?.phoneNumber || '') };
        const result = await api(`api/auth/sso/personal/${pending.verifying ? 'verify-email' : 'signup'}`,
            { method: 'POST', auth: false, body: { ...body, code: pending.code, verifier: pending.verifier } });
        if (pendingPersonal !== pending || workspace?.origin !== pending.origin) return { ok: false, error: 'Sign-in was cancelled.' };
        if (!result.ok) return { ok: false, error: result.error };
        if (typeof result.data?.verification === 'string') {
            pendingPersonal = { ...pending, code: result.data.verification, verifying: true };
            return { ok: true, verification: result.data.email };
        }
        pendingPersonal = undefined;
        return finishSignIn(result.data, pending.keep);
    });

    appHandler('auth:sso-cancel', () => { cancelSso?.(); });

    appHandler('auth:login', async (email: unknown, password: unknown, keep: unknown) => {
        cancelSso?.();
        pendingPersonal = undefined;
        const result = await api('api/auth/login', { method: 'POST', auth: false, body: { email: String(email || '').trim(), password: String(password || '') } });
        if (!result.ok || typeof result.data?.token !== 'string') return { ok: false, error: result.status === 401 ? 'Wrong email or password.' : result.error };
        token = result.data.token;
        user = cleanUser(result.data.user);
        writeConfig({ keepSignedIn: keep === true });
        saveSession();
        void reportDesktopActivation();
        return { ok: true, user };
    });

    appHandler('auth:logout', async () => {
        if (token) await api('api/auth/logout', { method: 'POST' });
        clearSession();
        return { ok: true };
    });

    appHandler('meetings:list', async (start: unknown, end: unknown) => {
        const query = new URLSearchParams({ start: String(start), end: String(end), limit: '100' });
        const result = await api(`api/meetings?${query}`);
        return result.ok ? { ok: true, meetings: Array.isArray(result.data?.meetings) ? result.data.meetings : [] } : { ok: false, error: result.error };
    });

    appHandler('meetings:create', async (title: unknown) => {
        const result = await api('api/meetings', { method: 'POST', body: { title: String(title || 'Instant meeting').slice(0, 200) } });
        return result.ok ? { ok: true, meeting: result.data } : { ok: false, error: result.error };
    });

    appHandler('meetings:schedule', async (input: any) => {
        const start = new Date(String(input?.start));
        const minutes = Math.min(480, Math.max(15, Number(input?.minutes) || 60));
        if (Number.isNaN(start.getTime())) return { ok: false, error: 'Choose a date and time.' };
        const result = await api('api/meetings/schedule', { method: 'POST', body: {
            title: String(input?.title || 'Scheduled meeting').slice(0, 200),
            scheduledStart: start.toISOString(), scheduledEnd: new Date(start.getTime() + minutes * 60000).toISOString(),
        } });
        return result.ok ? { ok: true, meeting: result.data } : { ok: false, error: result.error };
    });

    appHandler('meetings:join', async (raw: unknown) => {
        const code = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
        if (!MEETING_CODE.test(code)) return { ok: false, error: 'Enter a meeting code like QS-ABCD-EFGH-IJKL.' };
        const found = await api(`api/meetings/code/${encodeURIComponent(code)}`, { auth: false });
        if (found.status === 404) return { ok: false, error: 'No meeting has that code.' };
        if (!found.ok && found.status !== 0) return { ok: false, error: found.error };
        if (found.status === 0) return { ok: false, error: found.error };
        openMeeting(code);
        return { ok: true };
    });

    appHandler('invite:copy', (code: unknown) => {
        const value = String(code || '').toUpperCase();
        if (!workspace || !MEETING_CODE.test(value)) return { ok: false };
        clipboard.writeText(`Join my QS-VC meeting\n${new URL(`meeting/${value}/preview`, workspace).href}\nCode: ${value}`);
        return { ok: true };
    });

    appHandler('settings:theme', (value: unknown) => {
        const theme: Theme = value === 'light' || value === 'dark' ? value : 'system';
        nativeTheme.themeSource = theme;
        writeConfig({ theme });
        return { ok: true, theme };
    });

    appHandler('settings:keep', (value: unknown) => { writeConfig({ keepSignedIn: value === true }); saveSession(); return { ok: true }; });

    appHandler('plans:open', (requestedPlan: unknown) => {
        if (!workspace) return { ok: false, error: 'Connect to your organisation first.' };
        const plan = ['starter', 'pro', 'enterprise'].includes(String(requestedPlan)) ? String(requestedPlan) : '';
        const plans = new URL(`/pricing${plan ? `#plan-${plan}` : ''}`, workspace.origin);
        if (plans.protocol !== 'https:' && !( !app.isPackaged && plans.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(plans.hostname))) return { ok: false, error: 'The plans page is unavailable.' };
        void shell.openExternal(plans.href);
        return { ok: true };
    });

    appHandler('app:notify', (title: unknown, body: unknown) => { new Notification({ title: String(title).slice(0, 80), body: String(body).slice(0, 200) }).show(); });

    // The renderer sees only a placeholder. The actual credential stays in this process.
    ipcMain.on('meeting:session-marker', event => {
        const url = event.senderFrame?.url || '';
        event.returnValue = event.sender === mainWindow?.webContents && event.senderFrame === mainWindow?.webContents.mainFrame && inMeeting(url) ? meetingMarker : '';
    });
}

// ━━━ Deep links: qsvc://join/<code> ━━━

function handleDeepLink(link: string) {
    try {
        const parsed = new URL(link);
        const code = decodeURIComponent((parsed.host === 'join' ? parsed.pathname : parsed.pathname.replace(/^\/+join/, '')).replace(/^\/+/, '')).toUpperCase();
        if (!MEETING_CODE.test(code)) return;
        if (!mainWindow || !workspace) { pendingDeepLink = code; return; }
        mainWindow.show();
        openMeeting(code);
    } catch { /* ignore malformed links */ }
}

// ━━━ Release smoke test ━━━
// CI starts each packaged app with QSVC_SMOKE_TEST=<file>. The app writes OK once its window has
// rendered the start page, then quits; a startup crash leaves no file and fails the release.
function runSmokeTest(win: BrowserWindow, resultFile: string) {
    const finish = (result: string) => { try { fs.writeFileSync(resultFile, result); } catch { /* CI reports the missing file */ } app.exit(result === 'OK' ? 0 : 1); };
    win.webContents.once('did-fail-load', (_event, code, description) => finish(`FAIL load ${code} ${description}`));
    win.webContents.once('did-finish-load', () => {
        win.webContents.executeJavaScript('document.body ? document.body.innerText.length : 0')
            .then(length => finish(Number(length) > 0 ? 'OK' : 'FAIL empty start page'))
            .catch(error => finish(`FAIL ${error}`));
    });
}

// ━━━ Lifecycle ━━━

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    if (process.defaultApp && process.argv.length >= 2) app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
    else app.setAsDefaultProtocolClient(PROTOCOL);
    app.setName('QS-VC');

    app.on('second-instance', (_event, argv) => {
        if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
        const link = argv.find(arg => arg.startsWith(`${PROTOCOL}://`));
        if (link) handleDeepLink(link);
    });
    app.on('open-url', (event, link) => { event.preventDefault(); handleDeepLink(link); });
    app.on('before-quit', () => { quitting = true; });

    app.whenReady().then(() => {
        nativeTheme.themeSource = readConfig().theme || 'system';
        workspace = loadWorkspace();
        if (workspace) restoreSession();
        setupPermissions();
        setupIPC();
        mainWindow = createMainWindow();
        tray = createTray();
        const link = process.argv.find(arg => arg.startsWith(`${PROTOCOL}://`));
        if (link) handleDeepLink(link);
        if (pendingDeepLink && workspace) { const code = pendingDeepLink; pendingDeepLink = ''; mainWindow.webContents.once('did-finish-load', () => openMeeting(code)); }
        if (process.env.QSVC_SMOKE_TEST) runSmokeTest(mainWindow, process.env.QSVC_SMOKE_TEST);
    });

    app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
    app.on('activate', () => { if (!mainWindow) mainWindow = createMainWindow(); else mainWindow.show(); });
}
