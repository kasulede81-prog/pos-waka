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

function realpathOrNull(io, value) {
  if (!value) return null;
  if (typeof io.realpathSync === "function") {
    try {
      return path.resolve(io.realpathSync(value));
    } catch {
      return null;
    }
  }
  return path.resolve(value);
}

function isSymlinkOrJunction(io, value) {
  if (typeof io.lstatSync !== "function") return false;
  try {
    const st = io.lstatSync(value);
    return typeof st.isSymbolicLink === "function" && st.isSymbolicLink() === true;
  } catch {
    return false;
  }
}

function resolveLabExecutable(input = {}) {
  ignoreRendererLaunchInput(input.rendererPayload);
  const env = input.env || process.env;
  const io = input.fs || fs;
  const roots = labRootsFromNativeConfig(env, input.appPaths || {});
  if (roots.length === 0) {
    return { ok: false, error: "lab_dir_not_configured" };
  }

  const realRoots = [];
  for (const root of roots) {
    realRoots.push(realpathOrNull(io, root) || path.resolve(root));
  }

  const configured = String(env?.WAKA_RUSTDESK_EXECUTABLE_PATH ?? "").trim();
  const candidates = [];
  if (configured) {
    if (!isSafeAbsolutePath(configured)) {
      return { ok: false, error: "executable_path_rejected" };
    }
    candidates.push(path.resolve(configured));
  } else {
    for (const root of realRoots) {
      candidates.push(path.join(root, "rustdesk.exe"), path.join(root, "rustdesk"));
    }
  }

  for (const candidate of candidates) {
    if (!io.existsSync(candidate)) continue;
    if (isSymlinkOrJunction(io, candidate)) {
      return { ok: false, error: "executable_symlink_rejected" };
    }
    let stat;
    try {
      stat = io.statSync(candidate);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const name = path.basename(candidate).toLowerCase();
    if (!EXPECTED_FILENAMES.has(name)) continue;
    const realFile = realpathOrNull(io, candidate);
    if (!realFile) {
      return { ok: false, error: "executable_path_rejected" };
    }
    const inside = realRoots.some((root) => isInsideRoot(realFile, root));
    if (!inside) {
      return { ok: false, error: "executable_path_rejected" };
    }
    const realName = path.basename(realFile).toLowerCase();
    if (!EXPECTED_FILENAMES.has(realName)) {
      return { ok: false, error: "executable_not_allowlisted" };
    }
    return { ok: true, path: realFile };
  }

  return { ok: false, error: "executable_not_allowlisted" };
}

module.exports = {
  EXPECTED_FILENAMES,
  ignoreRendererLaunchInput,
  labRootsFromNativeConfig,
  resolveLabExecutable,
  isInsideRoot,
};
