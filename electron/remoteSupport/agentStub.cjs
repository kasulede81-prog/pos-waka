"use strict";

const { createSupportAgent } = require("./supportAgent.cjs");

/**
 * RS-2 compatibility wrapper. The Support Agent is in-process and does
 * not launch a Windows service or a transport process by default.
 */
function createRemoteSupportAgentStub(deps = {}) {
  return createSupportAgent(deps);
}

module.exports = { createRemoteSupportAgentStub };
