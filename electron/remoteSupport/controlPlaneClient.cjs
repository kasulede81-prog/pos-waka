"use strict";

const { isAllowlistedControlPlaneUrl } = require("./controlPlaneConfig.cjs");

function controlPlaneHeaders(accessToken) {
  return {
    apikey: String(process.env.VITE_SUPABASE_ANON_KEY || process.env.WAKA_SUPABASE_ANON_KEY || accessToken),
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
}

function controlPlaneRequestContext(input) {
  const url = String(input?.supabaseUrl ?? "").replace(/\/$/, "");
  const accessToken = String(input?.accessToken ?? "");
  const fingerprint = String(input?.deviceFingerprint ?? "").trim();
  const fetchFn = typeof input?.fetch === "function" ? input.fetch : fetch;
  const valid =
    isAllowlistedControlPlaneUrl(url) && accessToken.split(".").length === 3 && fingerprint.length >= 8;
  return { url, accessToken, fingerprint, fetchFn, valid };
}

/**
 * Apply server-side TTL/revoke before reading the customer inbox.
 * Failures are ignored so a missing RPC cannot skip the inbox check.
 */
async function expireStaleRemoteSupportOnControlPlane(input) {
  const ctx = controlPlaneRequestContext(input);
  if (!ctx.valid) return;
  try {
    await ctx.fetchFn(`${ctx.url}/rest/v1/rpc/remote_support_expire_stale`, {
      method: "POST",
      headers: controlPlaneHeaders(ctx.accessToken),
      body: JSON.stringify({ p_shop_id: null }),
    });
  } catch {
    /* inbox remains the authorization source */
  }
}

/**
 * Calls the existing customer inbox RPC. Uses the shop-user access token
 * only for this request. Does not persist tokens. Does not use a service role.
 */
async function fetchRemoteSupportPlatformEnabled(input) {
  const ctx = controlPlaneRequestContext(input);
  if (!ctx.valid) return false;
  try {
    const response = await ctx.fetchFn(`${ctx.url}/rest/v1/rpc/get_remote_support_platform_settings`, {
      method: "POST",
      headers: controlPlaneHeaders(ctx.accessToken),
      body: JSON.stringify({}),
    });
    if (!response.ok) return false;
    const data = await response.json();
    return Boolean(data && typeof data === "object" && data.enabled === true);
  } catch {
    return false;
  }
}

async function fetchRemoteSupportInboxFromControlPlane(input) {
  await expireStaleRemoteSupportOnControlPlane(input);
  const ctx = controlPlaneRequestContext(input);
  if (!ctx.valid) {
    return { request: null, session: null, enabled: false, error: "control_plane_unavailable" };
  }

  const enabled = await fetchRemoteSupportPlatformEnabled(input);
  if (!enabled) {
    return { request: null, session: null, enabled: false };
  }

  const response = await ctx.fetchFn(`${ctx.url}/rest/v1/rpc/remote_support_customer_inbox`, {
    method: "POST",
    headers: controlPlaneHeaders(ctx.accessToken),
    body: JSON.stringify({ p_device_fingerprint: ctx.fingerprint }),
  });

  if (!response.ok) {
    return { request: null, session: null, enabled: false, error: "control_plane_unavailable" };
  }

  const data = await response.json();
  if (!data || typeof data !== "object") {
    return { request: null, session: null, enabled: true };
  }
  return {
    request: data.request && typeof data.request === "object" ? data.request : null,
    session: data.session && typeof data.session === "object" ? data.session : null,
    enabled: true,
  };
}

module.exports = {
  fetchRemoteSupportInboxFromControlPlane,
  expireStaleRemoteSupportOnControlPlane,
  fetchRemoteSupportPlatformEnabled,
};
