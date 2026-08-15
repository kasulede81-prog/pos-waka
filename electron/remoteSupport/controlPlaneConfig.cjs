"use strict";

/**
 * Only these WAKA Supabase projects may be contacted from Electron main.
 * A renderer-supplied URL is never used — that would let a compromised UI
 * point the native layer at a fake "authorized" server.
 */
const ALLOWED_PROJECT_REFS = Object.freeze([
  "ljaedextsenbkxzzgxcg",
  "wdirxwvbgsfzbdurmkbf",
]);

const ALLOWED_REF_SET = new Set(ALLOWED_PROJECT_REFS);

function projectRefFromHostname(hostname) {
  const m = /^([a-z0-9]+)\.supabase\.co$/i.exec(String(hostname ?? ""));
  return m ? m[1].toLowerCase() : null;
}

function projectRefFromAuthStorageKey(key) {
  const m = /^sb-([a-z0-9]+)-auth-token$/i.exec(String(key ?? ""));
  return m ? m[1].toLowerCase() : null;
}

function isAllowlistedProjectRef(ref) {
  return ALLOWED_REF_SET.has(String(ref ?? "").toLowerCase());
}

function controlPlaneUrlForRef(ref) {
  if (!isAllowlistedProjectRef(ref)) return null;
  return `https://${String(ref).toLowerCase()}.supabase.co`;
}

function isAllowlistedControlPlaneUrl(url) {
  try {
    const parsed = new URL(String(url ?? ""));
    if (parsed.protocol !== "https:") return false;
    const ref = projectRefFromHostname(parsed.hostname);
    return Boolean(ref && isAllowlistedProjectRef(ref));
  } catch {
    return false;
  }
}

module.exports = {
  ALLOWED_PROJECT_REFS,
  projectRefFromAuthStorageKey,
  isAllowlistedProjectRef,
  isAllowlistedControlPlaneUrl,
  controlPlaneUrlForRef,
};
