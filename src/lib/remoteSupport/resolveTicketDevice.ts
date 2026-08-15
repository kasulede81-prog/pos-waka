/**
 * Resolve the exact POS for a support ticket.
 * Ticket fingerprint is targeting context — not Remote Support authorization.
 */

import { supabase } from "../supabase";
import type { ShopDeviceRow } from "../wakaInternalAdmin";
import { evaluateRemoteSupportEligibility, type RemoteSupportEligibilityDevice } from "./eligibility";
import type { RemoteSupportReasonCode } from "./types";

export type TicketDeviceLookup = {
  shopId?: string | null;
  deviceFingerprint?: string | null;
  diagnostics?: Record<string, unknown> | null;
};

export type ResolvedTicketDevice =
  | { ok: true; device: ShopDeviceRow }
  | {
      ok: false;
      error:
        | "shop_unavailable"
        | "device_fingerprint_missing"
        | "device_not_found"
        | "device_shop_mismatch"
        | "device_not_eligible";
      reason?: string;
    };

export function ticketDeviceFingerprint(input: TicketDeviceLookup): string {
  const direct = String(input.deviceFingerprint ?? "").trim();
  if (direct) return direct;
  const diagnostics = input.diagnostics ?? {};
  return String(diagnostics.deviceId ?? diagnostics.device_id ?? "").trim();
}

export function mapTicketIssueToReason(issueType: string | null | undefined): RemoteSupportReasonCode {
  const value = String(issueType ?? "").trim().toLowerCase();
  if (value === "printer") return "printer";
  if (value === "network") return "sync";
  if (value === "scanner" || value === "cash_drawer") return "hardware";
  if (value === "waka_pos") return "software";
  return "other";
}

export function assertTicketDeviceResolution(input: {
  shopId?: string | null;
  fingerprint?: string | null;
  device: (RemoteSupportEligibilityDevice & { id: string; shop_id?: string | null; device_fingerprint?: string | null }) | null;
  nowMs?: number;
}): ResolvedTicketDevice {
  const shopId = String(input.shopId ?? "").trim();
  const fingerprint = String(input.fingerprint ?? "").trim();
  if (!shopId) return { ok: false, error: "shop_unavailable" };
  if (!fingerprint) return { ok: false, error: "device_fingerprint_missing" };
  if (!input.device?.id) return { ok: false, error: "device_not_found" };
  if (input.device.shop_id && input.device.shop_id !== shopId) {
    return { ok: false, error: "device_shop_mismatch" };
  }
  if (input.device.device_fingerprint && input.device.device_fingerprint !== fingerprint) {
    return { ok: false, error: "device_not_found" };
  }
  const eligibility = evaluateRemoteSupportEligibility(input.device, input.nowMs);
  if (!eligibility.eligible) {
    return { ok: false, error: "device_not_eligible", reason: eligibility.explanation };
  }
  return { ok: true, device: input.device as ShopDeviceRow };
}

export async function fetchShopDeviceByFingerprint(
  shopId: string,
  fingerprint: string,
): Promise<ShopDeviceRow | null> {
  if (!supabase || !shopId || !fingerprint) return null;
  const { data, error } = await supabase
    .from("shop_devices")
    .select(
      "id,shop_id,device_fingerprint,label,platform,app_version,last_seen_at,last_login_at,device_authority,is_active,status,approval_status,trusted,suspicious_flag,created_at",
    )
    .eq("shop_id", shopId)
    .eq("device_fingerprint", fingerprint)
    .maybeSingle();
  if (error || !data) return null;
  return data as ShopDeviceRow;
}

export async function resolveTicketShopDevice(input: TicketDeviceLookup): Promise<ResolvedTicketDevice> {
  const shopId = String(input.shopId ?? "").trim();
  const fingerprint = ticketDeviceFingerprint(input);
  if (!shopId) return { ok: false, error: "shop_unavailable" };
  if (!fingerprint) return { ok: false, error: "device_fingerprint_missing" };
  const device = await fetchShopDeviceByFingerprint(shopId, fingerprint);
  return assertTicketDeviceResolution({ shopId, fingerprint, device });
}

export function ticketRemoteSupportPayload(input: {
  shopId: string;
  shopDeviceId: string;
  supportRequestId?: string | null;
  reasonCode: RemoteSupportReasonCode;
  reasonText: string;
}) {
  const supportRequestId = String(input.supportRequestId ?? "").trim() || null;
  return {
    shopId: input.shopId,
    shopDeviceId: input.shopDeviceId,
    supportRequestId,
    reasonCode: input.reasonCode,
    reasonText: input.reasonText,
  };
}
