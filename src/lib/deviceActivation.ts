import { Capacitor } from "@capacitor/core";
import { appendDeviceAuditEntry } from "./deviceAudit";
import { getOrCreateDeviceId } from "./deviceId";
import {
  notifyOwnerNewDeviceActivation,
  reportDeviceFingerprintChangeIfNeeded,
} from "./deviceFingerprintTrust";
import type { ShopDeviceRow } from "./shopDevices";
import { supabase } from "./supabase";
import {
  activationDeviceId,
  classifyActivationError,
  logActivationAttempt,
  logActivationFailure,
  logActivationStage,
  nextActivationAttempt,
  type ActivationFailureKind,
} from "./deviceActivationDiagnostics";

function presencePlatform(): string {
  if (typeof window === "undefined") return "server";
  if (Capacitor.isNativePlatform()) return Capacitor.getPlatform();
  return "web";
}

function presenceLabel(): string {
  const platform = presencePlatform();
  if (platform === "android") return "Android POS";
  if (platform === "ios") return "iOS POS";
  return "Web POS";
}

export type DeviceLimitContextDevice = {
  id: string;
  device_fingerprint: string;
  label: string | null;
  platform: string | null;
  last_seen_at: string | null;
  status: string;
  approval_status?: string;
};

export type DeviceLimitContext = {
  shop_id: string;
  plan_code: string;
  plan_name: string;
  device_limit: number | null;
  active_count: number;
  is_owner: boolean;
  at_limit: boolean;
  devices: DeviceLimitContextDevice[];
};

export type DeviceActivationResult = {
  ok: boolean;
  activated: boolean;
  accepted?: boolean;
  limit_blocked?: boolean;
  pending_approval?: boolean;
  approval_status?: string;
  approval_requested_at?: string;
  approval_expires_at?: string;
  approval_expired?: boolean;
  device_authority?: string;
  revoked?: boolean;
  existing_device?: boolean;
  reactivated?: boolean;
  owner_enrolled?: boolean;
  status?: string;
  plan_code?: string;
  plan_name?: string;
  active_count?: number;
  device_limit?: number | null;
};

export type ActivationBlockKind = "limit" | "pending" | "revoked" | "connection";

export type LoginDeviceActivationOutcome = {
  activated: boolean;
  result: DeviceActivationResult;
  failureReason?: ActivationFailureKind;
  failureDetail?: string;
  isOwner?: boolean;
};

function parseActivationResult(data: unknown): DeviceActivationResult {
  if (!data || typeof data !== "object") return { ok: false, activated: false };
  const r = data as Record<string, unknown>;
  const activated = r.activated === true && r.limit_blocked !== true;
  return {
    ok: r.ok === true,
    activated,
    accepted: r.accepted === true,
    limit_blocked: r.limit_blocked === true,
    pending_approval: r.pending_approval === true,
    approval_status: r.approval_status != null ? String(r.approval_status) : undefined,
    approval_requested_at:
      r.approval_requested_at != null ? String(r.approval_requested_at) : undefined,
    approval_expires_at: r.approval_expires_at != null ? String(r.approval_expires_at) : undefined,
    approval_expired: r.approval_expired === true,
    device_authority: r.device_authority != null ? String(r.device_authority) : undefined,
    revoked: r.revoked === true,
    existing_device: r.existing_device === true,
    reactivated: r.reactivated === true,
    owner_enrolled: r.owner_enrolled === true,
    status: r.status != null ? String(r.status) : undefined,
    plan_code: r.plan_code != null ? String(r.plan_code) : undefined,
    plan_name: r.plan_name != null ? String(r.plan_name) : undefined,
    active_count: typeof r.active_count === "number" ? r.active_count : undefined,
    device_limit:
      typeof r.device_limit === "number"
        ? r.device_limit
        : r.device_limit === null
          ? null
          : undefined,
  };
}

function presenceFields(shopId: string) {
  return {
    p_shop_id: shopId,
    p_device_fingerprint: getOrCreateDeviceId(),
    p_label: presenceLabel(),
    p_platform: presencePlatform(),
    p_app_version: import.meta.env.VITE_APP_VERSION ?? "1.0.0",
  };
}

function applyActivationSideEffects(shopId: string, parsed: DeviceActivationResult): void {
  void reportDeviceFingerprintChangeIfNeeded(shopId);
  if (parsed.reactivated) {
    appendDeviceAuditEntry("device_reactivated", "Device reactivated after login", {
      shopId,
      deviceFingerprint: getOrCreateDeviceId(),
    });
  }
  if (parsed.ok && parsed.activated && !parsed.existing_device && !parsed.reactivated) {
    void notifyOwnerNewDeviceActivation(shopId, getOrCreateDeviceId());
    appendDeviceAuditEntry("device_new_activation", "New device activated on this shop", {
      shopId,
      deviceFingerprint: getOrCreateDeviceId(),
    });
  }
  if (parsed.limit_blocked) {
    appendDeviceAuditEntry("device_login_blocked", "Device activation blocked at plan limit", {
      shopId,
      deviceFingerprint: getOrCreateDeviceId(),
      planCode: parsed.plan_code,
      activeCount: parsed.active_count,
      deviceLimit: parsed.device_limit,
    });
  }
}

export async function ensureShopDeviceActivation(shopId: string): Promise<DeviceActivationResult> {
  if (!shopId || !supabase) return { ok: true, activated: true };
  const args = presenceFields(shopId);
  const started = Date.now();
  logActivationStage("activate", { shopId });
  const { data, error } = await supabase.rpc("shop_device_ensure_activation", args);
  if (error) throw error;
  const parsed = parseActivationResult(data);
  logActivationAttempt({
    attempt: nextActivationAttempt(),
    shopId,
    deviceId: activationDeviceId(),
    stage: "activate",
    rpc: "shop_device_ensure_activation",
    elapsedMs: Date.now() - started,
    approvalStatus: parsed.approval_status,
    activationStatus: parsed.activated ? "activated" : parsed.approval_status ?? parsed.status,
  });
  applyActivationSideEffects(shopId, parsed);
  return parsed;
}

export async function registerShopDeviceOnLogin(shopId: string): Promise<DeviceActivationResult> {
  if (!shopId || !supabase) return { ok: true, activated: true };
  const args = presenceFields(shopId);
  const started = Date.now();
  const { data, error } = await supabase.rpc("shop_device_register_on_login", args);
  if (error) throw error;
  const parsed = parseActivationResult(data);
  logActivationAttempt({
    attempt: nextActivationAttempt(),
    shopId,
    deviceId: activationDeviceId(),
    stage: "register",
    rpc: "shop_device_register_on_login",
    elapsedMs: Date.now() - started,
    approvalStatus: parsed.approval_status,
    activationStatus: parsed.activated ? "activated" : parsed.status,
  });
  applyActivationSideEffects(shopId, parsed);
  return parsed;
}

/** Resolve block screen for staff device gate. Owners should not reach pending/activating states. */
export function resolveActivationBlockKind(opts: {
  result: DeviceActivationResult;
  context: DeviceLimitContext | null;
  currentDevice: ShopDeviceRow | null;
  failureReason?: ActivationFailureKind;
}): ActivationBlockKind {
  if (opts.result.revoked || opts.failureReason === "revoked" || opts.failureReason === "device_revoked") {
    return "revoked";
  }
  if (
    opts.result.limit_blocked ||
    opts.failureReason === "limit_reached" ||
    opts.failureReason === "device_limit_reached"
  ) {
    return "limit";
  }

  const pending =
    opts.result.pending_approval ||
    opts.result.approval_status === "pending" ||
    opts.currentDevice?.approval_status === "pending";

  if (pending && opts.context?.is_owner === false) {
    return "pending";
  }

  if (
    opts.failureReason === "timeout" ||
    opts.failureReason === "network" ||
    opts.failureReason === "network_error" ||
    opts.failureReason === "rpc_failure"
  ) {
    return "connection";
  }

  if (pending) {
    return "pending";
  }

  return "connection";
}

/**
 * Owner-first login enrollment: single server RPC handles register + approve + activate.
 * Staff devices still return pending when approval is required.
 */
export async function resolveLoginDeviceActivation(shopId: string): Promise<LoginDeviceActivationOutcome> {
  logActivationStage("login", { shopId, deviceId: activationDeviceId() });

  let context: DeviceLimitContext | null = null;
  try {
    context = await fetchShopDeviceLimitContext(shopId);
  } catch {
    context = null;
  }
  const isOwner = context?.is_owner ?? false;

  let result: DeviceActivationResult;
  try {
    logActivationStage("register", { shopId, ownerFirst: isOwner });
    result = await registerShopDeviceOnLogin(shopId);
  } catch (error) {
    const failureReason = classifyActivationError(error);
    logActivationFailure("register", failureReason, { shopId });
    return {
      activated: false,
      result: { ok: false, activated: false },
      failureReason,
      failureDetail: error instanceof Error ? error.message : undefined,
      isOwner,
    };
  }

  if (result.activated) {
    logActivationStage("completed", { shopId, ownerEnrolled: result.owner_enrolled });
    return { activated: true, result, isOwner };
  }

  if (result.revoked) {
    return { activated: false, result, failureReason: "device_revoked", isOwner };
  }

  if (result.limit_blocked || (context?.at_limit && isOwner)) {
    return { activated: false, result, failureReason: "device_limit_reached", isOwner };
  }

  if (result.pending_approval || result.approval_status === "pending") {
    if (!isOwner) {
      return { activated: false, result, failureReason: "device_pending", isOwner: false };
    }
    logActivationFailure("register", "activation_failed", {
      shopId,
      detail: "owner_received_pending_after_enrollment_rpc",
    });
    return {
      activated: false,
      result,
      failureReason: "activation_failed",
      failureDetail: "owner_pending_unexpected",
      isOwner: true,
    };
  }

  return {
    activated: false,
    result,
    failureReason: "activation_failed",
    isOwner,
  };
}

/** Activate this device and continue login when the plan still has room. */
export async function tryActivateCurrentDevice(shopId: string): Promise<DeviceActivationResult> {
  const outcome = await resolveLoginDeviceActivation(shopId);
  return outcome.result;
}

export async function fetchShopDeviceLimitContext(shopId: string): Promise<DeviceLimitContext | null> {
  if (!shopId || !supabase) return null;
  const { data, error } = await supabase.rpc("shop_device_limit_context", { p_shop_id: shopId });
  if (error) throw error;
  if (!data || typeof data !== "object") return null;
  const r = data as Record<string, unknown>;
  const devicesRaw = r.devices;
  const devices = Array.isArray(devicesRaw)
    ? devicesRaw.map((row) => {
        const d = row as Record<string, unknown>;
        return {
          id: String(d.id ?? ""),
          device_fingerprint: String(d.device_fingerprint ?? ""),
          label: d.label != null ? String(d.label) : null,
          platform: d.platform != null ? String(d.platform) : null,
          last_seen_at: d.last_seen_at != null ? String(d.last_seen_at) : null,
          status: String(d.status ?? "active"),
          approval_status: d.approval_status != null ? String(d.approval_status) : undefined,
        };
      })
    : [];
  const limitRaw = r.device_limit;
  return {
    shop_id: String(r.shop_id ?? shopId),
    plan_code: String(r.plan_code ?? ""),
    plan_name: String(r.plan_name ?? ""),
    device_limit: typeof limitRaw === "number" && limitRaw > 0 ? limitRaw : null,
    active_count: typeof r.active_count === "number" ? r.active_count : 0,
    is_owner: Boolean(r.is_owner),
    at_limit: Boolean(r.at_limit),
    devices,
  };
}

export async function recordDeviceReplacementCompleted(
  shopId: string,
  oldDeviceFingerprint: string,
): Promise<void> {
  const newFp = getOrCreateDeviceId();
  appendDeviceAuditEntry("device_replacement_completed", "Owner freed a device slot for this device", {
    shopId,
    oldDeviceFingerprint,
    newDeviceFingerprint: newFp,
  });
  if (!supabase) return;
  await supabase.rpc("owner_record_device_replacement", {
    p_shop_id: shopId,
    p_old_device_fingerprint: oldDeviceFingerprint,
    p_new_device_fingerprint: newFp,
  });
}

/** @deprecated Phase 20.6 — owner enrollment is server-side; kept for migration compatibility. */
export async function tryOwnerApproveCurrentDevice(
  shopId: string,
): Promise<{ ok: boolean; failureReason?: ActivationFailureKind; failureDetail?: string }> {
  const outcome = await resolveLoginDeviceActivation(shopId);
  return {
    ok: outcome.activated,
    failureReason: outcome.failureReason,
    failureDetail: outcome.failureDetail,
  };
}
