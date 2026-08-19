"use strict";

/** Fixed IPC channel names for LAN ESC/POS. Renderer cannot invent channels. */
const PRINTER_CHANNELS = Object.freeze({
  PRINT_ESCPOS: "waka:hardware:printer:print-escpos",
  TEST_CONNECTION: "waka:hardware:printer:test-connection",
  GET_STATUS: "waka:hardware:printer:get-status",
});

const PRINTER_CHANNEL_SET = new Set(Object.values(PRINTER_CHANNELS));

function isPrinterChannel(name) {
  return typeof name === "string" && PRINTER_CHANNEL_SET.has(name);
}

module.exports = {
  PRINTER_CHANNELS,
  isPrinterChannel,
};
