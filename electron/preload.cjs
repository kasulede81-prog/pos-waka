const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("wakaDesktop", {
  platform: process.platform,
  print: (opts) => ipcRenderer.invoke("waka-print", opts ?? {}),
  getPrinterDiagnostics: () => ipcRenderer.invoke("waka-printer-diagnostics"),
  /** Desktop recovery only — reloads packaged index without clearing storage. */
  reloadApp: () => ipcRenderer.invoke("waka:shell:reload-app"),
  /**
   * Typed hardware surface. LAN ESC/POS only — no generic sockets.
   * cashDrawer intentionally omitted (Phase 4B).
   */
  hardware: {
    printer: {
      printEscPos: (opts) => ipcRenderer.invoke("waka:hardware:printer:print-escpos", opts ?? {}),
      testConnection: (opts) =>
        ipcRenderer.invoke("waka:hardware:printer:test-connection", opts ?? {}),
      getStatus: (opts) => ipcRenderer.invoke("waka:hardware:printer:get-status", opts ?? {}),
    },
  },
  /**
   * Compatibility alias used by printerAdapter — same dedicated print channel.
   * Prefer hardware.printer.printEscPos for new call sites.
   */
  escPosNetwork: (opts) => ipcRenderer.invoke("waka:hardware:printer:print-escpos", opts ?? {}),
  remoteSupport: {
    getStatus: () => ipcRenderer.invoke("waka:remote-support:get-status"),
    endSession: () => ipcRenderer.invoke("waka:remote-support:end"),
    requestAuthorizationCheck: () => ipcRenderer.invoke("waka:remote-support:authorization-check"),
    startAuthorizedTransport: () => ipcRenderer.invoke("waka:remote-support:start-transport"),
    stopTransport: () => ipcRenderer.invoke("waka:remote-support:stop-transport"),
    getTransportStatus: () => ipcRenderer.invoke("waka:remote-support:get-transport-status"),
  },
});
