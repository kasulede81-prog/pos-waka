"use strict";

/** Fixed IPC names for desktop print protocol V1. Renderer cannot invent channels. */
const PRINT_HANDOFF_CHANNELS = Object.freeze({
  EVENT: "waka:print-handoff",
  TAKE: "waka:print-handoff:take",
});

module.exports = {
  PRINT_HANDOFF_CHANNELS,
};
