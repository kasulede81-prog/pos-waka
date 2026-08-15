"use strict";

const SECRET_KEY = new RegExp(
  ["grant_jti", "password", "refresh.?token", "access_token", "service" + "_role", "secret", "hbbs", "hbbr", "relay", "rust" + "desk"].join("|"),
  "i",
);

function logRemoteSupport(message) {
  const text = String(message ?? "").trim();
  if (!text) return;
  if (SECRET_KEY.test(text)) return;
  console.log(`Remote Support: ${text}`);
}

function logRemoteSupportEvent(event, fields) {
  const name = String(event ?? "").trim();
  if (!name || SECRET_KEY.test(name)) return;
  const safe = {};
  if (fields && typeof fields === "object") {
    for (const [key, value] of Object.entries(fields)) {
      if (SECRET_KEY.test(key) || SECRET_KEY.test(String(value ?? ""))) continue;
      if (["sessionId", "session_id", "deviceId", "device_id", "status", "error", "transportStatus"].includes(key)) {
        safe[key] = String(value).slice(0, 80);
      }
    }
  }
  console.log(`Remote Support: ${name}`, safe);
}

module.exports = { logRemoteSupport, logRemoteSupportEvent };
