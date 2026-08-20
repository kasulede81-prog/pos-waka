import type { RemoteSupportInbox } from "./types";
import type { RemoteSupportUiPhase } from "./transport";

export type RemoteSupportStatusTone = "idle" | "warning" | "ok" | "critical";

export type RemoteSupportStatusCardModel = {
  tone: RemoteSupportStatusTone;
  headlineKey: string;
  detailKey: string;
  deviceLabel: string | null;
};

export function formatRemoteSupportDeviceLabel(deviceId: string | null | undefined): string | null {
  const id = String(deviceId ?? "").trim();
  if (!id) return null;
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}…`;
}

export function resolveRemoteSupportStatusCardModel(input: {
  inbox: RemoteSupportInbox;
  uiPhase: RemoteSupportUiPhase;
  deviceId: string;
  electronDesktop: boolean;
}): RemoteSupportStatusCardModel {
  const deviceLabel = formatRemoteSupportDeviceLabel(input.deviceId);
  const request = input.inbox.request?.status ?? null;
  const session = input.inbox.session?.status ?? null;
  const phase = input.uiPhase;

  if (phase === "active" || session === "active") {
    return {
      tone: "ok",
      headlineKey: "remoteSupportStatusActive",
      detailKey: "remoteSupportStatusActiveDetail",
      deviceLabel,
    };
  }
  if (phase === "ending") {
    return {
      tone: "warning",
      headlineKey: "remoteSupportStatusEnding",
      detailKey: "remoteSupportStatusEndingDetail",
      deviceLabel,
    };
  }
  if (phase === "connecting" || session === "connecting") {
    return {
      tone: "warning",
      headlineKey: "remoteSupportStatusConnecting",
      detailKey: input.electronDesktop
        ? "remoteSupportStatusConnectingDetail"
        : "remoteSupportStatusWebTransportDetail",
      deviceLabel,
    };
  }
  if (phase === "requested" || request === "requested") {
    return {
      tone: "warning",
      headlineKey: "remoteSupportStatusRequested",
      detailKey: "remoteSupportStatusRequestedDetail",
      deviceLabel,
    };
  }

  return {
    tone: "idle",
    headlineKey: "remoteSupportStatusIdle",
    detailKey: input.electronDesktop ? "remoteSupportStatusIdleDetail" : "remoteSupportStatusIdleWebDetail",
    deviceLabel,
  };
}
