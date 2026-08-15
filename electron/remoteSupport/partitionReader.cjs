"use strict";

const {
  projectRefFromAuthStorageKey,
  controlPlaneUrlForRef,
} = require("./controlPlaneConfig.cjs");

const DEVICE_KEY = "waka-pos-device-id";

/**
 * Reads the current WAKA device id and shop-user access token from the
 * BrowserWindow partition. This is the existing localStorage identity —
 * not hardware authentication. A compromised renderer can change these
 * values, but it cannot change the control-plane response.
 *
 * The access token is used only for the in-flight authorization check.
 * It is not stored, logged, or exposed on window.wakaDesktop.
 */
function parseAccessToken(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const token = parsed?.access_token || parsed?.currentSession?.access_token;
    if (typeof token === "string" && token.split(".").length === 3) return token;
  } catch {
    return null;
  }
  return null;
}

function snapshotFromLocalStorageMap(map) {
  const store = map && typeof map === "object" ? map : {};
  const deviceFingerprint = String(store[DEVICE_KEY] ?? "").trim();
  let supabaseUrl = null;
  let accessToken = null;
  for (const [key, value] of Object.entries(store)) {
    const ref = projectRefFromAuthStorageKey(key);
    if (!ref) continue;
    const url = controlPlaneUrlForRef(ref);
    const token = parseAccessToken(value);
    if (url && token) {
      supabaseUrl = url;
      accessToken = token;
      break;
    }
  }
  return { deviceFingerprint, supabaseUrl, accessToken };
}

async function readPartitionAuthorizationMaterial(webContents) {
  if (!webContents || typeof webContents.executeJavaScript !== "function") {
    return snapshotFromLocalStorageMap({});
  }
  const map = await webContents.executeJavaScript(
    `(() => {
      const out = {};
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key) continue;
          if (key === ${JSON.stringify(DEVICE_KEY)} || (key.startsWith("sb-") && key.endsWith("-auth-token"))) {
            out[key] = localStorage.getItem(key);
          }
        }
      } catch (e) {}
      return out;
    })()`,
  );
  return snapshotFromLocalStorageMap(map);
}

module.exports = {
  DEVICE_KEY,
  parseAccessToken,
  snapshotFromLocalStorageMap,
  readPartitionAuthorizationMaterial,
};
