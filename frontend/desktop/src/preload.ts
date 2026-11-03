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

    // First-run setup (the main process only answers the local setup screen)
    getWorkspace: () => ipcRenderer.invoke('workspace:get'),
    setWorkspace: (url: string) => ipcRenderer.invoke('workspace:set', url),

    // Event listeners

    // Platform info
    platform: process.platform,
    isDesktop: true,
});
