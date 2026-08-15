/**
 * RS-2.1 / RS-4A renderer types for the Electron native Remote Support boundary.
 *
 * Native agent state ≠ control-plane session state ≠ transport state.
 * The renderer may request a check or start/stop. It must not supply
 * authorization, grant_jti, tokens, or transport credentials.
 */

import type { RemoteSupportTransportStatus, RemoteSupportUiPhase } from "./transport";

export type RemoteSupportNativeStatus =
  | "idle"
  | "authorization_pending"
  | "authorized_stub"
  | "stopped"
  | "revoked"
  | "expired"
  | "not_authorized"
  | "error";

export type RemoteSupportNativeResult = {
  ok: boolean;
  status: RemoteSupportNativeStatus | string;
  error?: string;
  transportInstalled?: boolean;
  transportEnabled?: boolean;
  transportStatus?: RemoteSupportTransportStatus | string;
  uiPhase?: RemoteSupportUiPhase | string;
  credentialRotationUnsupported?: boolean;
};

export type WakaDesktopRemoteSupportApi = {
  getStatus: () => Promise<RemoteSupportNativeResult>;
  endSession: () => Promise<RemoteSupportNativeResult>;
  requestAuthorizationCheck: () => Promise<RemoteSupportNativeResult>;
  startAuthorizedTransport: () => Promise<RemoteSupportNativeResult>;
  stopTransport: () => Promise<RemoteSupportNativeResult>;
  getTransportStatus: () => Promise<RemoteSupportNativeResult>;
};

export function getWakaDesktopRemoteSupport(): WakaDesktopRemoteSupportApi | null {
  if (typeof window === "undefined") return null;
  const api = window.wakaDesktop?.remoteSupport;
  if (
    !api?.getStatus ||
    !api.requestAuthorizationCheck ||
    !api.startAuthorizedTransport ||
    !api.stopTransport ||
    !api.getTransportStatus
  ) {
    return null;
  }
  return api;
}

export function nativeStatusFromControlPlane(status: string | null | undefined): RemoteSupportNativeStatus {
  switch (String(status ?? "").trim().toLowerCase()) {
    case "requested":
    case "pending":
      return "authorization_pending";
    case "connecting":
    case "active":
      return "authorized_stub";
    case "revoked":
      return "revoked";
    case "expired":
      return "expired";
    case "ended":
    case "failed":
    case "declined":
    case "cancelled":
    case "approved":
    case "no_session":
      return "not_authorized";
    default:
      return "error";
  }
}
