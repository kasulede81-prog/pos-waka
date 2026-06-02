const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("wakaDesktop", {
  platform: process.platform,
  print: (opts) => ipcRenderer.invoke("waka-print", opts ?? {}),
  getPrinterDiagnostics: () => ipcRenderer.invoke("waka-printer-diagnostics"),
});
