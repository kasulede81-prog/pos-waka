"use strict";

const { readTransportFlag } = require("./transportFlag.cjs");
const { createDisabledRemoteSupportTransport } = require("./disabledTransport.cjs");
const { createMockRemoteSupportTransport } = require("./mockTransport.cjs");
const { createRustDeskTransportAdapter } = require("./rustdeskAdapter.cjs");

function createTransportFromFlag(env = process.env, overrides = {}) {
  if (overrides.transport) return overrides.transport;
  const mode = overrides.mode || readTransportFlag(env);
  if (mode === "mock") return createMockRemoteSupportTransport();
  if (mode === "lab") {
    return createRustDeskTransportAdapter({
      labEnabled: true,
      env,
      appPaths: overrides.appPaths,
      fs: overrides.fs,
      supervisor: overrides.supervisor,
      connectionProbe: overrides.connectionProbe,
    });
  }
  return createDisabledRemoteSupportTransport();
}

module.exports = { createTransportFromFlag };
