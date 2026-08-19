"use strict";

/**
 * Sanitize native errors before returning them to the renderer.
 * Never forward stacks, env, credentials, or absolute paths.
 */

const SENSITIVE =
  /service[_-]?role|refresh[_-]?token|access[_-]?token|grant_jti|password|secret|authorization|bearer\s+[a-z0-9._-]+|rustdesk|hbbs|hbbr/i;

function sanitizeShellError(input, fallback = "Desktop action failed") {
  const raw = String(input ?? "").trim();
  if (!raw) return fallback;
  if (SENSITIVE.test(raw)) return fallback;

  let cleaned = raw
    .replace(/[A-Za-z]:\\[^\s"'`]+/g, "[path]")
    .replace(/\/(?:Users|home|var|tmp|private)\/[^\s"'`]+/g, "[path]")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || cleaned.length > 180) return fallback;
  return cleaned;
}

module.exports = {
  sanitizeShellError,
};
