/**
 * Andromeda Launcher — Preload Script
 * Exposes a safe IPC bridge to the renderer (splash.html)
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("launcher", {
  // Receive events from main
  onLog:         (cb) => ipcRenderer.on("log",          (_e, d) => cb(d)),
  onStep:        (cb) => ipcRenderer.on("step",         (_e, d) => cb(d)),
  onServerReady: (cb) => ipcRenderer.on("server-ready", (_e, d) => cb(d)),
  onShowEnvBtn:  (cb) => ipcRenderer.on("show-env-button", (_e, d) => cb(d)),

  // Send actions to main
  minimize:    () => ipcRenderer.send("window-minimize"),
  close:       () => ipcRenderer.send("window-close"),
  openBrowser: () => ipcRenderer.send("open-browser"),
  openEnv:     () => ipcRenderer.send("open-env"),
});
