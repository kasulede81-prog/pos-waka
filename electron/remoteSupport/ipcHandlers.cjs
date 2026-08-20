"use strict";

const { REMOTE_SUPPORT_CHANNELS } = require("./channels.cjs");
const { createSupportAgent } = require("./supportAgent.cjs");
const { readPartitionAuthorizationMaterial } = require("./partitionReader.cjs");
const { fetchRemoteSupportInboxFromControlPlane } = require("./controlPlaneClient.cjs");
const { sanitizePublicResult } = require("./transportTypes.cjs");
const { logRemoteSupportEvent } = require("./log.cjs");

const liveAgents = new Set();

function safeResult(result) {
  return sanitizePublicResult(result);
}

async function loadSnapshotFromSender(webContents) {
  const material = await readPartitionAuthorizationMaterial(webContents);
  const inbox = await fetchRemoteSupportInboxFromControlPlane({
    supabaseUrl: material.supabaseUrl,
    accessToken: material.accessToken,
    deviceFingerprint: material.deviceFingerprint,
  });
  return {
    deviceFingerprint: material.deviceFingerprint,
    remoteSupportEnabled: inbox.enabled === true,
    controlPlaneError: inbox.error || null,
    inbox: { request: inbox.request, session: inbox.session },
  };
}

function trackRemoteSupportAgent(agent, webContents) {
  liveAgents.add(agent);
  if (webContents && typeof webContents.once === "function") {
    webContents.once("destroyed", () => {
      liveAgents.delete(agent);
      void Promise.resolve()
        .then(() => agent.stopTransport())
        .catch(() => {});
    });
  }
}

async function stopAllRemoteSupportTransports() {
  const list = [...liveAgents];
  liveAgents.clear();
  if (list.length > 0) {
    logRemoteSupportEvent("transport_stopped", { error: "app_quit_cleanup" });
  }
  for (const agent of list) {
    try {
      await agent.stopTransport();
    } catch {
      logRemoteSupportEvent("transport_error", { error: "stop_failed" });
    }
  }
}

function registerRemoteSupportIpc(ipcMain) {
  const agentBySender = new WeakMap();

  function agentFor(webContents) {
    let agent = agentBySender.get(webContents);
    if (!agent) {
      agent = createSupportAgent({
        loadSnapshot: () => loadSnapshotFromSender(webContents),
      });
      agentBySender.set(webContents, agent);
      trackRemoteSupportAgent(agent, webContents);
    }
    return agent;
  }

  ipcMain.handle(REMOTE_SUPPORT_CHANNELS.GET_STATUS, (event, ..._ignored) =>
    safeResult(agentFor(event.sender).getStatus()),
  );

  ipcMain.handle(REMOTE_SUPPORT_CHANNELS.END, async (event, ..._ignored) =>
    safeResult(await agentFor(event.sender).stopTransport()),
  );

  ipcMain.handle(REMOTE_SUPPORT_CHANNELS.AUTHORIZATION_CHECK, async (event, ..._ignored) =>
    safeResult(await agentFor(event.sender).requestAuthorizationCheck()),
  );

  ipcMain.handle(REMOTE_SUPPORT_CHANNELS.START_TRANSPORT, async (event, ..._ignored) =>
    safeResult(await agentFor(event.sender).startAuthorizedTransport()),
  );

  ipcMain.handle(REMOTE_SUPPORT_CHANNELS.STOP_TRANSPORT, async (event, ..._ignored) =>
    safeResult(await agentFor(event.sender).stopTransport()),
  );

  ipcMain.handle(REMOTE_SUPPORT_CHANNELS.GET_TRANSPORT_STATUS, (event, ..._ignored) =>
    safeResult(agentFor(event.sender).getTransportStatus()),
  );
}

module.exports = {
  registerRemoteSupportIpc,
  loadSnapshotFromSender,
  stopAllRemoteSupportTransports,
  trackRemoteSupportAgent,
};
