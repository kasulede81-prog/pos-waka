"use strict";

/**
 * Pure navigation helpers for the Electron desktop shell.
 * Keep the packaged app from becoming a generic browser.
 */

const path = require("node:path");
const { pathToFileURL } = require("node:url");

function tryParseUrl(raw) {
  try {
    return new URL(String(raw ?? ""));
  } catch {
    return null;
  }
}

function isHttpOrHttps(url) {
  const parsed = tryParseUrl(url);
  if (!parsed) return false;
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

function isDangerousScheme(url) {
  const parsed = tryParseUrl(url);
  if (!parsed) return true;
  const protocol = parsed.protocol.toLowerCase();
  return (
    protocol === "javascript:" ||
    protocol === "data:" ||
    protocol === "vbscript:" ||
    protocol === "blob:"
  );
}

function normalizeFilePath(p) {
  return decodeURIComponent(String(p || ""))
    .replace(/\\/g, "/")
    .toLowerCase();
}

function toFilePathname(absolutePath) {
  return normalizeFilePath(new URL(pathToFileURL(path.resolve(absolutePath)).href).pathname);
}

/**
 * Allow in-window navigation only to packaged app HTML (index + recovery).
 * @param {string} url
 * @param {string|string[]} allowedHtmlAbsolutePaths
 */
function isAllowedAppNavigation(url, allowedHtmlAbsolutePaths) {
  const parsed = tryParseUrl(url);
  if (!parsed) return false;
  if (parsed.protocol === "about:" && parsed.pathname === "blank") return true;
  if (parsed.protocol !== "file:") return false;

  const allowed = Array.isArray(allowedHtmlAbsolutePaths)
    ? allowedHtmlAbsolutePaths
    : [allowedHtmlAbsolutePaths];

  const actual = normalizeFilePath(parsed.pathname);
  return allowed.some((candidate) => {
    try {
      return actual === toFilePathname(candidate);
    } catch {
      return false;
    }
  });
}

/**
 * Decide how the shell should treat a navigation/open attempt.
 * @returns {{ action: "allow" | "deny" | "open-external" }}
 */
function classifyNavigation(url, allowedHtmlAbsolutePaths) {
  if (isDangerousScheme(url)) return { action: "deny" };
  if (isAllowedAppNavigation(url, allowedHtmlAbsolutePaths)) return { action: "allow" };
  if (isHttpOrHttps(url)) return { action: "open-external" };
  return { action: "deny" };
}

module.exports = {
  tryParseUrl,
  isHttpOrHttps,
  isDangerousScheme,
  isAllowedAppNavigation,
  classifyNavigation,
};
