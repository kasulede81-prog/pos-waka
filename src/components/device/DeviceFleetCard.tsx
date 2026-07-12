import { Copy, MonitorSmartphone, Wifi, WifiOff } from "lucide-react";
import clsx from "clsx";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import type { ShopDeviceRow } from "../../lib/shopDevices";
import {
  formatDeviceDisplayName,
  formatDevicePlatformLabel,
  formatLastActiveRelative,
} from "../../lib/devicePresenceFormat";
import {
  presenceLabelKey,
  resolveDeviceFleetBucket,
  type DeviceFleetBucket,
} from "../../lib/deviceFleetCatalog";
import { resolveDevicePresence, shortDeviceFingerprint } from "../../lib/deviceFleetPresence";
import {
  formatPendingApprovalCountdown,
  isPendingApprovalExpired,
  pendingApprovalRemainingMs,
} from "../../lib/devicePendingApproval";

export type DeviceFleetCardProps = {
  lang: Language;
  device: ShopDeviceRow;
  displayName?: string;
  currentFingerprint: string;
  nowMs: number;
  isShopOwner: boolean;
  busy: boolean;
  staffLabel?: string | null;
  onSelect: (device: ShopDeviceRow) => void;
  onApprove: (device: ShopDeviceRow) => void;
  onDismiss: (device: ShopDeviceRow) => void;
  onDisconnect: (device: ShopDeviceRow) => void;
  onRemove: (device: ShopDeviceRow) => void;
  onCopyId: (device: ShopDeviceRow) => void;
  onRetryActivation?: () => void;
};

function bucketLabelKey(bucket: DeviceFleetBucket): string {
  switch (bucket) {
    case "current":
      return "deviceFleetBucketCurrent";
    case "approved":
      return "deviceFleetBucketApproved";
    case "pending":
      return "deviceFleetBucketPending";
    case "offline":
      return "deviceFleetBucketOffline";
    case "disconnected":
      return "deviceFleetBucketDisconnected";
    case "revoked":
      return "deviceFleetBucketRevoked";
  }
}

function approvalBadge(lang: Language, device: ShopDeviceRow, nowMs: number): string {
  if (device.approval_status === "pending") {
    if (isPendingApprovalExpired(device.approval_requested_at, nowMs)) {
      return t(lang, "deviceMgmtStatusExpired");
    }
    return t(lang, "deviceMgmtStatusPendingApproval");
  }
  if (device.approval_status === "approved") return t(lang, "deviceMgmtStatusApproved");
  if (device.approval_status === "revoked") return t(lang, "deviceMgmtStatusRevoked");
  if (device.approval_status === "suspended") return t(lang, "deviceMgmtStatusSuspended");
  return t(lang, "deviceMgmtStatusBlocked");
}

function lastActiveText(lang: Language, iso: string | null, nowMs: number): string {
  const rel = formatLastActiveRelative(iso, nowMs);
  if (rel.key === "never") return t(lang, "connectedDevicesLastActiveNever");
  if (rel.key === "just_now") return t(lang, "connectedDevicesLastActiveJustNow");
  return iso ? new Date(iso).toLocaleString() : "—";
}

export function DeviceFleetCard({
  lang,
  device,
  displayName,
  currentFingerprint,
  nowMs,
  isShopOwner,
  busy,
  staffLabel,
  onSelect,
  onApprove,
  onDismiss,
  onDisconnect,
  onRemove,
  onCopyId,
  onRetryActivation,
}: DeviceFleetCardProps) {
  const isCurrent = device.device_fingerprint === currentFingerprint;
  const name = displayName ?? formatDeviceDisplayName(device.label, device.platform);
  const platform = formatDevicePlatformLabel(device.platform);
  const presence = resolveDevicePresence(device, nowMs);
  const bucket = resolveDeviceFleetBucket(device, currentFingerprint, nowMs);
  const pendingRemainingMs =
    device.approval_status === "pending" ? pendingApprovalRemainingMs(device.approval_requested_at, nowMs) : 0;
  const pendingExpired =
    device.approval_status === "pending" && isPendingApprovalExpired(device.approval_requested_at, nowMs);
  const presenceOnline = presence === "online";

  const showRetryActivation =
    isCurrent &&
    onRetryActivation &&
    (device.approval_status === "pending" ||
      device.approval_status === "revoked" ||
      device.status === "revoked" ||
      device.status === "disconnected");

  return (
    <li className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <button type="button" onClick={() => onSelect(device)} className="w-full text-left">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <MonitorSmartphone className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-black text-foreground">{name}</h2>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground">
                {t(lang, bucketLabelKey(bucket))}
              </span>
              <span
                className={clsx(
                  "rounded-full px-2 py-0.5 text-xs font-bold",
                  device.approval_status === "approved"
                    ? "bg-emerald-100 text-emerald-800"
                    : device.approval_status === "pending"
                      ? pendingExpired
                        ? "bg-muted text-muted-foreground"
                        : "bg-amber-100 text-amber-900"
                      : "bg-red-100 text-red-800",
                )}
              >
                {approvalBadge(lang, device, nowMs)}
              </span>
              {isCurrent ? (
                <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-bold text-sky-800">
                  {t(lang, "connectedDevicesCurrentBadge")}
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 text-sm font-medium text-muted-foreground">{platform}</p>
            <div className="mt-2 flex flex-wrap gap-3 text-xs font-semibold text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                {presenceOnline ? (
                  <Wifi className="h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <WifiOff className="h-3.5 w-3.5" />
                )}
                {t(lang, presenceLabelKey(presence))}
              </span>
              <span>
                {t(lang, "deviceMgmtLastSync")}:{" "}
                {device.last_sync_at ? new Date(device.last_sync_at).toLocaleString() : "—"}
              </span>
              <span>
                {t(lang, "connectedDevicesLastActivePrefix")}: {lastActiveText(lang, device.last_seen_at, nowMs)}
              </span>
              {device.app_version ? (
                <span>
                  {t(lang, "deviceMgmtVersion")}: {device.app_version}
                </span>
              ) : null}
              <span>
                {t(lang, "deviceFleetDeviceId")}: {shortDeviceFingerprint(device.device_fingerprint)}
              </span>
              {staffLabel ? (
                <span>
                  {t(lang, "deviceFleetStaff")}: {staffLabel}
                </span>
              ) : null}
            </div>
            {(device.pending_uploads ?? 0) > 0 || (device.pending_downloads ?? 0) > 0 ? (
              <p className="mt-1 text-xs font-medium text-amber-800">
                {t(lang, "deviceMgmtSyncQueue")}: ↑{device.pending_uploads ?? 0} ↓{device.pending_downloads ?? 0}
              </p>
            ) : null}
            {device.approval_status === "pending" && !pendingExpired ? (
              <p className="mt-1 text-xs font-semibold text-sky-900">
                {tTemplate(lang, "deviceMgmtPendingCountdown", {
                  time: formatPendingApprovalCountdown(pendingRemainingMs),
                })}
              </p>
            ) : null}
          </div>
        </div>
      </button>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onCopyId(device)}
          className="inline-flex min-h-[40px] items-center gap-1 rounded-xl border border-border px-3 text-xs font-bold text-foreground"
        >
          <Copy className="h-3.5 w-3.5" aria-hidden />
          {t(lang, "deviceFleetCopyId")}
        </button>
        <button
          type="button"
          onClick={() => onSelect(device)}
          className="min-h-[40px] rounded-xl border border-border px-3 text-xs font-bold text-foreground"
        >
          {t(lang, "deviceFleetViewDetails")}
        </button>
        {showRetryActivation ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onRetryActivation?.()}
            className="min-h-[40px] rounded-xl border border-sky-200 bg-sky-50 px-3 text-xs font-bold text-sky-900 disabled:opacity-50"
          >
            {t(lang, "deviceLimitRetryActivation")}
          </button>
        ) : null}
      </div>

      {isShopOwner && device.approval_status === "pending" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || pendingExpired}
            onClick={() => onApprove(device)}
            className="min-h-[44px] flex-1 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy ? t(lang, "deviceMgmtApproving") : t(lang, "deviceMgmtApprove")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDismiss(device)}
            className="min-h-[44px] flex-1 rounded-xl border border-red-200 bg-red-50 px-4 text-sm font-bold text-red-800 disabled:opacity-50"
          >
            {busy ? t(lang, "deviceMgmtDeleting") : t(lang, "deviceMgmtDeletePending")}
          </button>
        </div>
      ) : null}

      {isShopOwner && device.approval_status === "approved" && device.status === "active" ? (
        <div className="mt-3 flex flex-col gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onDisconnect(device)}
            className="min-h-[44px] w-full rounded-xl border border-border bg-muted px-4 text-sm font-bold text-foreground disabled:opacity-50"
          >
            {busy ? t(lang, "deviceMgmtDisconnecting") : t(lang, "deviceMgmtDisconnect")}
          </button>
          {!isCurrent ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onRemove(device)}
              className="min-h-[44px] w-full rounded-xl border border-red-200 bg-red-50 px-4 text-sm font-bold text-red-800 disabled:opacity-50"
            >
              {busy ? t(lang, "deviceMgmtRemoving") : t(lang, "deviceMgmtRemove")}
            </button>
          ) : (
            <p className="text-xs font-medium text-muted-foreground">{t(lang, "deviceFleetCurrentDisconnectHint")}</p>
          )}
        </div>
      ) : null}
    </li>
  );
}
