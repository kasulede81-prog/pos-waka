const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("wakaDesktop", {
  platform: process.platform,
  print: (opts) => ipcRenderer.invoke("waka-print", opts ?? {}),
  getPrinterDiagnostics: () => ipcRenderer.invoke("waka-printer-diagnostics"),
  remoteSupport: {
    getStatus: () => ipcRenderer.invoke("waka:remote-support:get-status"),
    endSession: () => ipcRenderer.invoke("waka:remote-support:end"),
    requestAuthorizationCheck: () => ipcRenderer.invoke("waka:remote-support:authorization-check"),
    startAuthorizedTransport: () => ipcRenderer.invoke("waka:remote-support:start-transport"),
    stopTransport: () => ipcRenderer.invoke("waka:remote-support:stop-transport"),
    getTransportStatus: () => ipcRenderer.invoke("waka:remote-support:get-transport-status"),
  },
});
