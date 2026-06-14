/** Human-readable device label for audit rows — never show raw UUIDs in owner UI. */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function formatAuditDeviceLabel(
  deviceId: string | null | undefined,
  payload?: Record<string, unknown>,
): string {
  const fromPayload =
    typeof payload?.deviceLabel === "string"
      ? payload.deviceLabel.trim()
      : typeof payload?.deviceName === "string"
        ? payload.deviceName.trim()
        : "";
  if (fromPayload) return fromPayload;

  const id = deviceId?.trim() ?? "";
  if (!id) return "POS Device";
  if (UUID_RE.test(id)) return `POS Device ···${id.slice(-4)}`;
  if (id.length > 24) return `POS Device ···${id.slice(-4)}`;
  return id;
}
