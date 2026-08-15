/**
 * Renderer-safe Remote Support transport types.
 * React must not learn vendor IDs, passwords, relay hosts, or process args.
 */

export type RemoteSupportTransportStatus =
  | "transport_unavailable"
  | "transport_stopped"
  | "transport_starting"
  | "transport_ready"
  | "transport_connecting"
  | "transport_active"
  | "transport_stopping"
  | "transport_failed";

export type RemoteSupportUiPhase =
  | "requested"
  | "connecting"
  | "active"
  | "ending"
  | "ended"
  | "unavailable";

export type RemoteSupportTransportResult = {
  ok: boolean;
  status: string;
  error?: string;
  transportInstalled?: boolean;
  transportEnabled?: boolean;
  transportStatus?: RemoteSupportTransportStatus | string;
  uiPhase?: RemoteSupportUiPhase | string;
  credentialRotationUnsupported?: boolean;
};

export function remoteSupportUiPhase(input: {
  controlPlaneRequestStatus?: string | null;
  controlPlaneSessionStatus?: string | null;
  transportStatus?: string | null;
}): RemoteSupportUiPhase {
  const transport = String(input.transportStatus ?? "").trim();
  if (transport === "transport_active") return "active";
  if (transport === "transport_stopping") return "ending";
  if (
    transport === "transport_starting" ||
    transport === "transport_ready" ||
    transport === "transport_connecting"
  ) {
    return "connecting";
  }

  const session = String(input.controlPlaneSessionStatus ?? "").trim().toLowerCase();
  const request = String(input.controlPlaneRequestStatus ?? "").trim().toLowerCase();
  if (session === "ended" || session === "revoked" || session === "expired" || session === "failed") {
    return "ended";
  }
  if (request === "requested" || request === "pending") return "requested";
  if (session === "connecting" || session === "active") {
    if (transport === "transport_unavailable" || transport === "transport_failed" || !transport) {
      return "unavailable";
    }
    return "connecting";
  }
  return "unavailable";
}
