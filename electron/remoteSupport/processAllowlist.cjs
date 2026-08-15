"use strict";

const path = require("node:path");
const fs = require("node:fs");

const EXPECTED_FILENAMES = new Set(["rustdesk.exe", "rustdesk"]);

function ignoreRendererLaunchInput(_raw) {
  return null;
}

function isSafeAbsolutePath(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw.includes("\0")) return false;
  if (!path.isAbsolute(raw)) return false;
  if (raw.includes("..")) return false;
  return true;
}

function labRootsFromNativeConfig(env = process.env, appPaths = {}) {
  const roots = [];
  const configured = String(env?.WAKA_REMOTE_SUPPORT_LAB_DIR ?? "").trim();
  if (isSafeAbsolutePath(configured)) roots.push(path.resolve(configured));
  if (isSafeAbsolutePath(appPaths.userData)) {
    roots.push(path.resolve(appPaths.userData, "remote-support-lab"));
  }
  if (isSafeAbsolutePath(appPaths.exeDir)) {
    roots.push(path.resolve(appPaths.exeDir, "remote-support-lab"));
  }
  return roots;
}

function isInsideRoot(candidate, root) {
  const resolved = path.resolve(candidate);
  const base = path.resolve(root);
  const rel = path.relative(base, resolved);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function resolveLabExecutable(input = {}) {
  ignoreRendererLaunchInput(input.rendererPayload);
  const env = input.env || process.env;
  const io = input.fs || fs;
  const roots = labRootsFromNativeConfig(env, input.appPaths || {});
  if (roots.length === 0) {
    return { ok: false, error: "lab_dir_not_configured" };
  }

  const configured = String(env?.WAKA_RUSTDESK_EXECUTABLE_PATH ?? "").trim();
  const candidates = [];
  if (configured) {
    if (!isSafeAbsolutePath(configured)) {
      return { ok: false, error: "executable_path_rejected" };
    }
    candidates.push(path.resolve(configured));
  } else {
    for (const root of roots) {
      candidates.push(path.join(root, "rustdesk.exe"), path.join(root, "rustdesk"));
    }
  }

  for (const candidate of candidates) {
    const allowed = roots.some((root) => isInsideRoot(candidate, root));
    if (!allowed) continue;
    if (!io.existsSync(candidate)) continue;
    let stat;
    try {
      stat = io.statSync(candidate);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const name = path.basename(candidate).toLowerCase();
    if (!EXPECTED_FILENAMES.has(name)) continue;
    return { ok: true, path: candidate };
  }

  return { ok: false, error: "executable_not_allowlisted" };
}

module.exports = {
  EXPECTED_FILENAMES,
  ignoreRendererLaunchInput,
  labRootsFromNativeConfig,
  resolveLabExecutable,
};
