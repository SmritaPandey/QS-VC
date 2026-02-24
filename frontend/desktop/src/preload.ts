/**
 * QS-VC Desktop — Preload Script (Secure Context Bridge)
 *
 * Exposes a safe, sandboxed API from the main process to the renderer.
 * No direct Node.js access is given to the web content.
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('qsvcDesktop', {
    // App info
    getInfo: () => ipcRenderer.invoke('app:getInfo'),

    // Native notifications
    notify: (title: string, body: string) => ipcRenderer.invoke('app:notify', title, body),

    // Window controls
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    setFullscreen: (flag: boolean) => ipcRenderer.invoke('window:setFullscreen', flag),

    // Meeting controls
    setPiP: (flag: boolean) => ipcRenderer.invoke('meeting:setPiP', flag),

    // Event listeners
    onQuickMeeting: (callback: () => void) => {
        ipcRenderer.on('quick-meeting', callback);
    },
    onJoinMeeting: (callback: () => void) => {
        ipcRenderer.on('join-meeting', callback);
    },
    onOpenSettings: (callback: () => void) => {
        ipcRenderer.on('open-settings', callback);
    },
    onDeepLinkJoin: (callback: (meetingCode: string) => void) => {
        ipcRenderer.on('deep-link-join', (_event, meetingCode) => callback(meetingCode));
    },
    onUpdateDownloaded: (callback: (version: string) => void) => {
        ipcRenderer.on('update-downloaded', (_event, version) => callback(version));
    },

    // Platform info
    platform: process.platform,
    isDesktop: true,
});
