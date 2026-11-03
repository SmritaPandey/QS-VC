/**
 * QS-VC Desktop Client — Electron main process (intranet edition).
 *
 * - First run asks for the organisation's workspace address (https only) and remembers it.
 *   IT can pre-set it with a `workspace.json` next to QS-VC.exe: {"workspaceUrl":"https://..."}.
 * - The window only ever shows that workspace; other links open in the system browser.
 * - Camera, microphone and screen sharing are granted to the workspace origin only.
 * - System tray, qsvc://join/<code> deep links, single instance.
 */
import { app, BrowserWindow, Tray, Menu, nativeImage, Notification, ipcMain, shell, session, desktopCapturer, dialog, net } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

const PROTOCOL = 'qsvc';
const MEETING_CODE = /^[A-Z0-9-]{4,32}$/i;
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let workspace: URL | null = null;

// ━━━ Organisation address ━━━

const configFile = () => path.join(app.getPath('userData'), 'config.json');

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
    const candidates: unknown[] = [process.env.QSVC_WEB_URL];
    for (const file of [configFile(), path.join(path.dirname(process.execPath), 'workspace.json')]) {
        try { candidates.push(JSON.parse(fs.readFileSync(file, 'utf8')).workspaceUrl); } catch { /* not configured */ }
    }
    for (const value of candidates) { const url = value ? parseWorkspace(value) : null; if (url) return url; }
    return null;
}

async function reachable(url: URL): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
        const response = await net.fetch(url.href, { method: 'GET', signal: controller.signal, redirect: 'manual' });
        return response.status > 0 && response.status < 500;
    } catch { return false; } finally { clearTimeout(timer); }
}

function showWorkspace(win: BrowserWindow, target?: string) {
    if (!workspace) { void win.loadFile(path.join(__dirname, '..', 'static', 'setup.html')); return; }
    void win.loadURL(target || workspace.href);
}

function sameOrigin(value: string): boolean {
    try { return !!workspace && new URL(value).origin === workspace.origin; } catch { return false; }
}

function fromSetupPage(frameUrl: string | undefined): boolean {
    return !!frameUrl && frameUrl.startsWith('file:') && frameUrl.endsWith('/static/setup.html');
}

// ━━━ Window ━━━

function createMainWindow(): BrowserWindow {
    const win = new BrowserWindow({
        width: 1280, height: 800, minWidth: 800, minHeight: 600,
        backgroundColor: '#0b1420',
        title: 'QS-VC',
        icon: path.join(__dirname, '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
        },
        show: false,
    });
    win.once('ready-to-show', () => { win.show(); win.focus(); });
    win.on('close', event => { if (!quitting && process.platform !== 'darwin' && tray) { event.preventDefault(); win.hide(); } });

    // Stay inside the organisation's workspace; everything else opens in the browser.
    const openOutside = (url: string) => { if (/^https:\/\//i.test(url)) void shell.openExternal(url); };
    win.webContents.setWindowOpenHandler(({ url }) => { if (!sameOrigin(url)) openOutside(url); else void win.loadURL(url); return { action: 'deny' }; });
    win.webContents.on('will-navigate', (event, url) => { if (!sameOrigin(url) && !url.startsWith('file:')) { event.preventDefault(); openOutside(url); } });
    win.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
        if (!isMainFrame || code === -3 || !workspace || !sameOrigin(url)) return;
        void dialog.showMessageBox(win, {
            type: 'warning', title: 'QS-VC', buttons: ['Retry', 'Change organisation address'], defaultId: 0, cancelId: 0,
            message: 'Cannot reach your organisation workspace.',
            detail: `${workspace.href}\n${description}\n\nConnect to your office network or VPN, then retry.`,
        }).then(({ response }) => { if (response === 0) showWorkspace(win); else changeWorkspace(); });
    });

    showWorkspace(win);
    return win;
}

function changeWorkspace() {
    workspace = null;
    if (!mainWindow) return;
    mainWindow.show();
    showWorkspace(mainWindow);
}

// ━━━ Media permissions and screen sharing ━━━

function setupPermissions() {
    const allowed = new Set(['media', 'display-capture', 'notifications', 'fullscreen', 'clipboard-sanitized-write']);
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        callback(allowed.has(permission) && sameOrigin(webContents.getURL()));
    });
    session.defaultSession.setPermissionCheckHandler((_webContents, permission, origin) => allowed.has(permission) && sameOrigin(origin));

    // getDisplayMedia() needs a handler in Electron: let the person pick a screen or window.
    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
        if (!sameOrigin(request.securityOrigin || request.frame?.url || '')) { callback({}); return; }
        try {
            const sources = (await desktopCapturer.getSources({ types: ['screen', 'window'] })).slice(0, 8);
            if (!sources.length || !mainWindow) { callback({}); return; }
            const { response } = await dialog.showMessageBox(mainWindow, {
                type: 'question', title: 'Share your screen', message: 'Choose what to share',
                buttons: [...sources.map(source => source.name.slice(0, 60) || 'Screen'), 'Cancel'],
                cancelId: sources.length, defaultId: 0, noLink: true,
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
        { label: 'Change organisation address…', click: changeWorkspace },
        { type: 'separator' },
        { label: 'Quit QS-VC', click: () => { quitting = true; app.quit(); } },
    ]));
    instance.on('double-click', show);
    return instance;
}

// ━━━ IPC ━━━

function setupIPC() {
    ipcMain.handle('app:getInfo', () => ({ version: app.getVersion(), platform: process.platform, arch: process.arch, isPackaged: app.isPackaged }));
    ipcMain.handle('app:notify', (event, title: unknown, body: unknown) => {
        if (!sameOrigin(event.senderFrame?.url || '')) return;
        new Notification({ title: String(title).slice(0, 80), body: String(body).slice(0, 200) }).show();
    });
    ipcMain.handle('window:minimize', () => mainWindow?.minimize());
    ipcMain.handle('window:maximize', () => { if (mainWindow?.isMaximized()) mainWindow.unmaximize(); else mainWindow?.maximize(); });
    ipcMain.handle('window:close', () => mainWindow?.close());
    ipcMain.handle('window:setFullscreen', (_event, flag: unknown) => mainWindow?.setFullScreen(flag === true));

    // Only the local setup screen may read or change the organisation address.
    ipcMain.handle('workspace:get', event => fromSetupPage(event.senderFrame?.url) ? (loadWorkspace()?.href || '') : '');
    ipcMain.handle('workspace:set', async (event, value: unknown) => {
        if (!fromSetupPage(event.senderFrame?.url)) return { ok: false, error: 'Not allowed.' };
        const url = parseWorkspace(value);
        if (!url) return { ok: false, error: 'Enter a full secure address that starts with https://' };
        if (!(await reachable(url))) return { ok: false, error: 'Cannot reach that address. Connect to your office network or VPN and try again.' };
        fs.mkdirSync(path.dirname(configFile()), { recursive: true });
        fs.writeFileSync(configFile(), JSON.stringify({ workspaceUrl: url.href }, null, 2), { mode: 0o600 });
        workspace = url;
        if (mainWindow) showWorkspace(mainWindow);
        return { ok: true };
    });
}

// ━━━ Deep links: qsvc://join/<code> ━━━

function handleDeepLink(link: string) {
    try {
        const parsed = new URL(link);
        const code = decodeURIComponent((parsed.host === 'join' ? parsed.pathname : parsed.pathname.replace(/^\/+join/, '')).replace(/^\/+/, ''));
        if (!MEETING_CODE.test(code) || !workspace || !mainWindow) return;
        mainWindow.show();
        showWorkspace(mainWindow, new URL(`meeting/${encodeURIComponent(code.toUpperCase())}/preview`, workspace).href);
    } catch { /* ignore malformed links */ }
}

// ━━━ Lifecycle ━━━

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    if (process.defaultApp && process.argv.length >= 2) app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
    else app.setAsDefaultProtocolClient(PROTOCOL);

    app.on('second-instance', (_event, argv) => {
        if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
        const link = argv.find(arg => arg.startsWith(`${PROTOCOL}://`));
        if (link) handleDeepLink(link);
    });
    app.on('open-url', (event, link) => { event.preventDefault(); handleDeepLink(link); });
    app.on('before-quit', () => { quitting = true; });

    app.whenReady().then(() => {
        workspace = loadWorkspace();
        setupPermissions();
        setupIPC();
        mainWindow = createMainWindow();
        tray = createTray();
        const link = process.argv.find(arg => arg.startsWith(`${PROTOCOL}://`));
        if (link) handleDeepLink(link);
    });

    app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
    app.on('activate', () => { if (!mainWindow) mainWindow = createMainWindow(); else mainWindow.show(); });
}
