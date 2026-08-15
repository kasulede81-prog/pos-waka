"use strict";

/** Fixed IPC channel names. Renderer cannot supply arbitrary channels. */
const REMOTE_SUPPORT_CHANNELS = Object.freeze({
  GET_STATUS: "waka:remote-support:get-status",
  END: "waka:remote-support:end",
  AUTHORIZATION_CHECK: "waka:remote-support:authorization-check",
  START_TRANSPORT: "waka:remote-support:start-transport",
  STOP_TRANSPORT: "waka:remote-support:stop-transport",
  GET_TRANSPORT_STATUS: "waka:remote-support:get-transport-status",
});

const REMOTE_SUPPORT_CHANNEL_SET = new Set(Object.values(REMOTE_SUPPORT_CHANNELS));

function isRemoteSupportChannel(name) {
  return typeof name === "string" && REMOTE_SUPPORT_CHANNEL_SET.has(name);
}

module.exports = {
  REMOTE_SUPPORT_CHANNELS,
  isRemoteSupportChannel,
};
