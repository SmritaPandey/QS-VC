/**
 * QS-VC Desktop — preload (secure bridge). No Node.js access reaches page code.
 * - The app's own page (static/app.html) gets `window.qsvcDesktop` to call the main process;
 *   the main process refuses these calls from any other page.
 * - The server's meeting room page receives a non-secret session marker, before its scripts run,
 *   so the meeting joins as the signed-in user instead of a guest.
 */
import { contextBridge, ipcRenderer } from 'electron';

if (location.protocol !== 'file:' && /^\/meeting\/[^/]+(\/preview)?\/?$/.test(location.pathname)) {
    try {
        const marker = ipcRenderer.sendSync('meeting:session-marker');
        if (typeof marker === 'string' && marker) sessionStorage.setItem('token', marker);
        else sessionStorage.removeItem('token');
    } catch { /* join as guest if the session is unavailable */ }
}

const call = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('qsvcDesktop', {
    isDesktop: true,
    platform: process.platform,
    state: () => call('app:state'),
    setWorkspace: (url: string) => call('workspace:set', url),
    discover: (email: string) => call('auth:discover', email),
    personalProviders: () => call('auth:personal-providers'),
    signInWithProvider: (provider: string, keep: boolean) => call('auth:personal', provider, keep),
    completePersonalSignIn: (profile: object) => call('auth:personal-complete', profile),
    cancelPersonalSignIn: () => call('auth:personal-cancel'),
    signInWithOrganisation: (email: string, keep: boolean) => call('auth:sso', email, keep),
    cancelOrganisationSignIn: () => call('auth:sso-cancel'),
    login: (email: string, password: string, keep: boolean) => call('auth:login', email, password, keep),
    logout: () => call('auth:logout'),
    listMeetings: (start: string, end: string) => call('meetings:list', start, end),
    createMeeting: (title: string) => call('meetings:create', title),
    scheduleMeeting: (input: { title: string; start: string; minutes: number }) => call('meetings:schedule', input),
    joinMeeting: (code: string) => call('meetings:join', code),
    copyInvite: (code: string) => call('invite:copy', code),
    setTheme: (theme: string) => call('settings:theme', theme),
    setKeepSignedIn: (keep: boolean) => call('settings:keep', keep),
    openPlans: (plan?: string) => call('plans:open', plan),
    notify: (title: string, body: string) => call('app:notify', title, body),
    onEvent: (callback: (event: string, payload?: unknown) => void) => {
        ipcRenderer.on('app:event', (_event, name: string, payload: unknown) => callback(name, payload));
    },
});
