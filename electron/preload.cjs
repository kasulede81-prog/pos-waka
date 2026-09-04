const { contextBridge, ipcRenderer } = require("electron");
const { PRINT_HANDOFF_CHANNELS } = require("./printHandoff/channels.cjs");

function subscribePrintHandoff(callback) {
  if (typeof callback !== "function") return () => {};
  let lastSeq = -1;
  const deliver = (payload) => {
    if (!payload || typeof payload !== "object") return;
    const saleId = typeof payload.saleId === "string" ? payload.saleId.trim() : "";
    if (!saleId) return;
    const seq = typeof payload.seq === "number" ? payload.seq : 0;
    if (seq === lastSeq && lastSeq >= 0) return;
    lastSeq = seq;
    callback({ type: "print", version: 1, saleId });
  };
  const listen = ipcRenderer["on"].bind(ipcRenderer);
  const wrapped = (_event, payload) => deliver(payload);
  listen(PRINT_HANDOFF_CHANNELS.EVENT, wrapped);
  void ipcRenderer.invoke(PRINT_HANDOFF_CHANNELS.TAKE).then(deliver).catch(() => {});
  return () => {
    ipcRenderer.removeListener(PRINT_HANDOFF_CHANNELS.EVENT, wrapped);
  };
}

contextBridge.exposeInMainWorld("wakaDesktop", {
  platform: process.platform,
  print: (opts) => ipcRenderer.invoke("waka-print", opts ?? {}),
  getPrinterDiagnostics: () => ipcRenderer.invoke("waka-printer-diagnostics"),
  /** Desktop recovery only — reloads packaged index without clearing storage. */
  reloadApp: () => ipcRenderer.invoke("waka:shell:reload-app"),
  /** Print Protocol V1 — saleId only. Main already validated the URI. */
  onPrintHandoff: subscribePrintHandoff,
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
