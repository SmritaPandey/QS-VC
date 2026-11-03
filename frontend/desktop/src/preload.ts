/**
 * QS-VC Desktop — preload (secure bridge). No Node.js access reaches page code.
 * - The app's own page (static/app.html) gets `window.qsvcDesktop` to call the main process;
 *   the main process refuses these calls from any other page.
 * - The server's meeting room page receives the signed-in session once, before its scripts run,
 *   so the meeting joins as the signed-in user instead of a guest.
 */
import { contextBridge, ipcRenderer } from 'electron';

if (location.protocol !== 'file:' && /^\/meeting\/[^/]+(\/preview)?\/?$/.test(location.pathname)) {
    try {
        const token = ipcRenderer.sendSync('meeting:token');
        if (typeof token === 'string' && token) sessionStorage.setItem('token', token);
    } catch { /* join as guest if the session is unavailable */ }
}

const call = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('qsvcDesktop', {
    isDesktop: true,
    platform: process.platform,
    state: () => call('app:state'),
    setWorkspace: (url: string) => call('workspace:set', url),
    login: (email: string, password: string, keep: boolean) => call('auth:login', email, password, keep),
    logout: () => call('auth:logout'),
    listMeetings: (start: string, end: string) => call('meetings:list', start, end),
    createMeeting: (title: string) => call('meetings:create', title),
    scheduleMeeting: (input: { title: string; start: string; minutes: number }) => call('meetings:schedule', input),
    joinMeeting: (code: string) => call('meetings:join', code),
    copyInvite: (code: string) => call('invite:copy', code),
    setTheme: (theme: string) => call('settings:theme', theme),
    setKeepSignedIn: (keep: boolean) => call('settings:keep', keep),
    notify: (title: string, body: string) => call('app:notify', title, body),
    onEvent: (callback: (event: string, payload?: unknown) => void) => {
        ipcRenderer.on('app:event', (_event, name: string, payload: unknown) => callback(name, payload));
    },
});
