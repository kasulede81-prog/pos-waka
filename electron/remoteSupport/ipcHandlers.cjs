"use strict";

const { REMOTE_SUPPORT_CHANNELS } = require("./channels.cjs");
const { createSupportAgent } = require("./supportAgent.cjs");
const { readPartitionAuthorizationMaterial } = require("./partitionReader.cjs");
const { fetchRemoteSupportInboxFromControlPlane } = require("./controlPlaneClient.cjs");
const { sanitizePublicResult } = require("./transportTypes.cjs");

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
    controlPlaneError: inbox.error || null,
    inbox: { request: inbox.request, session: inbox.session },
  };
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

module.exports = { registerRemoteSupportIpc, loadSnapshotFromSender };
