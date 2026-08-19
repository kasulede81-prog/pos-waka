"use strict";

const { PRINTER_CHANNELS } = require("./channels.cjs");
const {
  printEscPos,
  testConnection,
  getStatus,
} = require("./escPosNetwork.cjs");

function toPublicResult(result) {
  if (!result || result.ok === true) {
    return {
      ok: true,
      message: result?.userMessage || result?.message || "Printer connected",
      status: result?.status,
      code: result?.code,
    };
  }
  return {
    ok: false,
    error: result.userMessage || result.error || "Could not connect to printer",
    code: result.code,
    status: result.status,
  };
}

/**
 * Register dedicated printer IPC handlers. No generic invoke / socket API.
 * @param {import('electron').IpcMain} ipcMain
 */
function registerPrinterIpc(ipcMain) {
  ipcMain.handle(PRINTER_CHANNELS.PRINT_ESCPOS, async (_event, args) => {
    const result = await printEscPos(args);
    return toPublicResult(result);
  });

  ipcMain.handle(PRINTER_CHANNELS.TEST_CONNECTION, async (_event, args) => {
    const result = await testConnection(args);
    return toPublicResult(result);
  });

  ipcMain.handle(PRINTER_CHANNELS.GET_STATUS, async (_event, args) => {
    const result = await getStatus(args);
    return toPublicResult(result);
  });
}

module.exports = {
  registerPrinterIpc,
  toPublicResult,
};
