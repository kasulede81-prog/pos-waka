"use strict";

const { isAllowlistedControlPlaneUrl } = require("./controlPlaneConfig.cjs");

/**
 * Calls the existing customer inbox RPC. Uses the shop-user access token
 * only for this request. Does not persist tokens. Does not use a service role.
 */
async function fetchRemoteSupportInboxFromControlPlane(input) {
  const url = String(input?.supabaseUrl ?? "").replace(/\/$/, "");
  const accessToken = String(input?.accessToken ?? "");
  const fingerprint = String(input?.deviceFingerprint ?? "").trim();
  if (!isAllowlistedControlPlaneUrl(url) || accessToken.split(".").length !== 3 || fingerprint.length < 8) {
    return { request: null, session: null, error: "control_plane_unavailable" };
  }

  const response = await fetch(`${url}/rest/v1/rpc/remote_support_customer_inbox`, {
    method: "POST",
    headers: {
      apikey: String(process.env.VITE_SUPABASE_ANON_KEY || process.env.WAKA_SUPABASE_ANON_KEY || accessToken),
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_device_fingerprint: fingerprint }),
  });

  if (!response.ok) {
    return { request: null, session: null, error: "control_plane_unavailable" };
  }

  const data = await response.json();
  if (!data || typeof data !== "object") {
    return { request: null, session: null };
  }
  return {
    request: data.request && typeof data.request === "object" ? data.request : null,
    session: data.session && typeof data.session === "object" ? data.session : null,
  };
}

module.exports = { fetchRemoteSupportInboxFromControlPlane };
