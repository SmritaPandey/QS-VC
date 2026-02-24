/**
 * QS-VC Desktop Client — Electron Main Process
 *
 * Features:
 * - BrowserWindow loading the web client
 * - System tray with quick actions
 * - Auto-updates via electron-updater
 * - Native notifications
 * - OS-level media device access
 * - Deep link handling (qsvc:// protocol)
 */
import { app, BrowserWindow, Tray, Menu, nativeImage, Notification, ipcMain, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import * as path from 'path';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONFIGURATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const WEB_CLIENT_URL = process.env.QSVC_WEB_URL || 'http://localhost:5173';
const IS_DEV = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// WINDOW MANAGEMENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function createMainWindow(): BrowserWindow {
    const win = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        titleBarStyle: 'hiddenInset',
        backgroundColor: '#0a0a0f',
        icon: getIconPath(),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
        },
        show: false,
    });

    // Load the web client
    win.loadURL(WEB_CLIENT_URL);

    // Show window when ready (avoid flash of white)
    win.once('ready-to-show', () => {
        win.show();
        win.focus();
    });

    // Handle window close (minimize to tray on non-macOS)
    win.on('close', (event) => {
        if (process.platform !== 'darwin' && tray) {
            event.preventDefault();
            win.hide();
        }
    });

    // Open external links in system browser
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http')) {
            shell.openExternal(url);
        }
        return { action: 'deny' };
    });

    // Grant media permissions automatically
    win.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => {
        const allowedPermissions = ['media', 'mediaKeySystem', 'notifications', 'fullscreen'];
        callback(allowedPermissions.includes(permission));
    });

    return win;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SYSTEM TRAY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function createTray(): Tray {
    const icon = nativeImage.createFromPath(getIconPath());
    const trayInstance = new Tray(icon.resize({ width: 16, height: 16 }));

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Open QS-VC',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                }
            },
        },
        { type: 'separator' },
        {
            label: 'Quick Meeting',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.webContents.send('quick-meeting');
                }
            },
        },
        {
            label: 'Join Meeting',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.webContents.send('join-meeting');
                }
            },
        },
        { type: 'separator' },
        {
            label: 'Settings',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.webContents.send('open-settings');
                }
            },
        },
        { type: 'separator' },
        {
            label: 'Check for Updates',
            click: () => autoUpdater.checkForUpdatesAndNotify(),
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click: () => {
                app.quit();
            },
        },
    ]);

    trayInstance.setToolTip('QS-VC Video Conferencing');
    trayInstance.setContextMenu(contextMenu);

    trayInstance.on('double-click', () => {
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
        }
    });

    return trayInstance;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AUTO-UPDATER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function setupAutoUpdater(): void {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available', (info) => {
        new Notification({
            title: 'Update Available',
            body: `Version ${info.version} is available. Downloading...`,
        }).show();
    });

    autoUpdater.on('update-downloaded', (info) => {
        new Notification({
            title: 'Update Ready',
            body: `Version ${info.version} will be installed on restart.`,
        }).show();

        if (mainWindow) {
            mainWindow.webContents.send('update-downloaded', info.version);
        }
    });

    autoUpdater.on('error', (err) => {
        console.error('Auto-updater error:', err);
    });

    // Check for updates every 4 hours
    setInterval(() => {
        autoUpdater.checkForUpdatesAndNotify();
    }, 4 * 60 * 60 * 1000);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// IPC HANDLERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function setupIPC(): void {
    // Get app info
    ipcMain.handle('app:getInfo', () => ({
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        isPackaged: app.isPackaged,
    }));

    // Native notifications
    ipcMain.handle('app:notify', (_event, title: string, body: string) => {
        new Notification({ title, body }).show();
    });

    // Window controls
    ipcMain.handle('window:minimize', () => mainWindow?.minimize());
    ipcMain.handle('window:maximize', () => {
        if (mainWindow?.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow?.maximize();
        }
    });
    ipcMain.handle('window:close', () => mainWindow?.close());
    ipcMain.handle('window:setFullscreen', (_event, flag: boolean) => {
        mainWindow?.setFullScreen(flag);
    });

    // Meeting-specific window controls
    ipcMain.handle('meeting:setPiP', (_event, flag: boolean) => {
        if (mainWindow) {
            mainWindow.setAlwaysOnTop(flag);
            if (flag) {
                mainWindow.setSize(400, 300);
                mainWindow.setPosition(
                    require('electron').screen.getPrimaryDisplay().workAreaSize.width - 420,
                    20
                );
            } else {
                mainWindow.setSize(1280, 800);
                mainWindow.center();
            }
        }
    });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DEEP LINK (qsvc:// protocol)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function setupDeepLinks(): void {
    const PROTOCOL = 'qsvc';

    if (process.defaultApp) {
        if (process.argv.length >= 2) {
            app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
        }
    } else {
        app.setAsDefaultProtocolClient(PROTOCOL);
    }

    // Handle deep link on Windows/Linux (single instance)
    const gotTheLock = app.requestSingleInstanceLock();
    if (!gotTheLock) {
        app.quit();
        return;
    }

    app.on('second-instance', (_event, argv) => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }

        // Parse the deep link URL from argv
        const url = argv.find((arg) => arg.startsWith(`${PROTOCOL}://`));
        if (url) {
            handleDeepLink(url);
        }
    });

    // Handle deep link on macOS
    app.on('open-url', (event, url) => {
        event.preventDefault();
        handleDeepLink(url);
    });
}

function handleDeepLink(url: string): void {
    // Parse: qsvc://join/MEETING_CODE
    try {
        const parsed = new URL(url);
        if (parsed.pathname.startsWith('/join/')) {
            const meetingCode = parsed.pathname.replace('/join/', '');
            if (mainWindow) {
                mainWindow.webContents.send('deep-link-join', meetingCode);
            }
        }
    } catch (err) {
        console.error('Invalid deep link:', url, err);
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// UTILITIES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function getIconPath(): string {
    const ext = process.platform === 'win32' ? 'ico' : process.platform === 'darwin' ? 'icns' : 'png';
    return path.join(__dirname, '..', 'assets', `icon.${ext}`);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// APP LIFECYCLE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

setupDeepLinks();

app.whenReady().then(() => {
    mainWindow = createMainWindow();
    tray = createTray();
    setupIPC();

    if (!IS_DEV) {
        setupAutoUpdater();
        autoUpdater.checkForUpdatesAndNotify();
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        mainWindow = createMainWindow();
    } else {
        mainWindow.show();
    }
});
