/**
 * Shop-wide selling / cash policy sync.
 *
 * Isolated from catalog (pending_catalog) and from device-only preferences.
 * Local hydrated authority remains usePosStore.preferences.
 * Remote authority is shop_policy_settings via shop_push/pull_shop_policy.
 *
 * Conflict rule (per field, deterministic LWW):
 * - Compare ISO timestamps (invalid/missing = epoch).
 * - Newer timestamp wins.
 * - Equal timestamps: lexicographically greater canonical value wins
 *   so arrival order cannot resurrect a stale peer.
 * - false / 0 / empty-string are legitimate values; never merge with ||.
 */

import type { ShopPreferences } from "../types";
import type { RegisterMode } from "./primaryRegisterMode";
import { supabase } from "./supabase";

export const SHOP_POLICY_SYNC_KEYS = [
  "discountControlMode",
  "discountMaxPercentThreshold",
  "kioskQuickSell",
  "staffCanRecordCashExpenses",
  "requireCashierExpenseApproval",
  "registerMode",
  "primaryDeviceFingerprint",
] as const;

export type ShopPolicySyncKey = (typeof SHOP_POLICY_SYNC_KEYS)[number];

export type DiscountControlMode = "unrestricted" | "manager_approval" | "max_percent";

export type ShopPolicyField<T> = {
  value: T;
  updatedAt: string;
};

export type ShopPolicyCloudDocument = {
  shopId?: string;
  empty?: boolean;
  discountControlMode?: ShopPolicyField<DiscountControlMode>;
  discountMaxPercentThreshold?: ShopPolicyField<number>;
  kioskQuickSell?: ShopPolicyField<boolean>;
  staffCanRecordCashExpenses?: ShopPolicyField<boolean>;
  requireCashierExpenseApproval?: ShopPolicyField<boolean>;
  registerMode?: ShopPolicyField<RegisterMode>;
  primaryDeviceFingerprint?: ShopPolicyField<string | null>;
};

const EPOCH = "1970-01-01T00:00:00.000Z";

export function shopPolicyIsoTimeMs(value: string | undefined | null): number {
  if (!value) return 0;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

export function preferencesPatchTouchesShopPolicy(patch: Partial<ShopPreferences>): boolean {
  return SHOP_POLICY_SYNC_KEYS.some((key) => key in patch);
}

function shopPolicyValuesEqual(a: unknown, b: unknown): boolean {
  return Object.is(a, b);
}

export function normalizeShopPolicyRevisions(
  raw: ShopPreferences["shopPolicyRevisions"] | undefined,
): ShopPreferences["shopPolicyRevisions"] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const next: NonNullable<ShopPreferences["shopPolicyRevisions"]> = {};
  for (const key of SHOP_POLICY_SYNC_KEYS) {
    const at = raw[key];
    if (typeof at === "string" && at.trim()) next[key] = at;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

export function stampShopPolicyPreferencePatch(
  prev: ShopPreferences,
  patch: Partial<ShopPreferences>,
  now = new Date().toISOString(),
): Partial<ShopPreferences> {
  const revisions = { ...(prev.shopPolicyRevisions ?? {}) };
  let changed = false;
  for (const key of SHOP_POLICY_SYNC_KEYS) {
    if (!(key in patch)) continue;
    if (shopPolicyValuesEqual(prev[key], patch[key])) continue;
    revisions[key] = now;
    changed = true;
  }
  if (!changed) return patch;
  return { ...patch, shopPolicyRevisions: revisions };
}

export function preferencesPatchNeedsShopPolicySync(
  prev: ShopPreferences,
  patch: Partial<ShopPreferences>,
): boolean {
  return SHOP_POLICY_SYNC_KEYS.some((key) => key in patch && !shopPolicyValuesEqual(prev[key], patch[key]));
}

function parseDiscountMode(value: unknown): DiscountControlMode | null {
  if (value === "unrestricted" || value === "manager_approval" || value === "max_percent") return value;
  return null;
}

function parseThreshold(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.floor(n);
}

function parseBooleanField(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  return null;
}

function parseRegisterMode(value: unknown): RegisterMode | null {
  if (value === "single" || value === "multi") return value;
  return null;
}

const MAX_FINGERPRINT_LENGTH = 128;

/** Valid fingerprint, empty/null (no designated primary), or undefined = invalid / skip. */
function parsePrimaryDeviceFingerprint(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length < 8 || trimmed.length > MAX_FINGERPRINT_LENGTH) return undefined;
  return trimmed;
}

function canonicalTieBreak(value: unknown): string {
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number") return String(value);
  return String(value ?? "");
}

/** Remote wins when newer, or on equal timestamp when its canonical value is greater. */
export function shopPolicyRemoteWins(
  localUpdatedAt: string | undefined,
  remoteUpdatedAt: string | undefined,
  localValue: unknown,
  remoteValue: unknown,
): boolean {
  const localMs = shopPolicyIsoTimeMs(localUpdatedAt);
  const remoteMs = shopPolicyIsoTimeMs(remoteUpdatedAt);
  if (remoteMs !== localMs) return remoteMs > localMs;
  return canonicalTieBreak(remoteValue) > canonicalTieBreak(localValue);
}

export function shopPolicyDocumentFromPreferences(prefs: ShopPreferences): ShopPolicyCloudDocument {
  const rev = prefs.shopPolicyRevisions ?? {};
  return {
    shopId: prefs.wakaShopId ?? undefined,
    discountControlMode: {
      value: parseDiscountMode(prefs.discountControlMode) ?? "unrestricted",
      updatedAt: rev.discountControlMode ?? EPOCH,
    },
    discountMaxPercentThreshold: {
      value: parseThreshold(prefs.discountMaxPercentThreshold) ?? 10,
      updatedAt: rev.discountMaxPercentThreshold ?? EPOCH,
    },
    kioskQuickSell: {
      value: prefs.kioskQuickSell === true,
      updatedAt: rev.kioskQuickSell ?? EPOCH,
    },
    staffCanRecordCashExpenses: {
      value: prefs.staffCanRecordCashExpenses === true,
      updatedAt: rev.staffCanRecordCashExpenses ?? EPOCH,
    },
    requireCashierExpenseApproval: {
      value: prefs.requireCashierExpenseApproval === true,
      updatedAt: rev.requireCashierExpenseApproval ?? EPOCH,
    },
    registerMode: {
      value: parseRegisterMode(prefs.registerMode) ?? "multi",
      updatedAt: rev.registerMode ?? EPOCH,
    },
    primaryDeviceFingerprint: {
      value: parsePrimaryDeviceFingerprint(prefs.primaryDeviceFingerprint ?? null) ?? null,
      updatedAt: rev.primaryDeviceFingerprint ?? EPOCH,
    },
  };
}

export function buildShopPolicyPushPayload(prefs: ShopPreferences): Record<string, unknown> {
  const doc = shopPolicyDocumentFromPreferences(prefs);
  return {
    discount_control_mode: doc.discountControlMode?.value,
    discount_control_mode_updated_at: doc.discountControlMode?.updatedAt,
    discount_max_percent_threshold: doc.discountMaxPercentThreshold?.value,
    discount_max_percent_threshold_updated_at: doc.discountMaxPercentThreshold?.updatedAt,
    kiosk_quick_sell: doc.kioskQuickSell?.value,
    kiosk_quick_sell_updated_at: doc.kioskQuickSell?.updatedAt,
    staff_can_record_cash_expenses: doc.staffCanRecordCashExpenses?.value,
    staff_can_record_cash_expenses_updated_at: doc.staffCanRecordCashExpenses?.updatedAt,
    require_cashier_expense_approval: doc.requireCashierExpenseApproval?.value,
    require_cashier_expense_approval_updated_at: doc.requireCashierExpenseApproval?.updatedAt,
    register_mode: doc.registerMode?.value,
    register_mode_updated_at: doc.registerMode?.updatedAt,
    primary_device_fingerprint: doc.primaryDeviceFingerprint?.value,
    primary_device_fingerprint_updated_at: doc.primaryDeviceFingerprint?.updatedAt,
  };
}

function fieldFromRaw<T>(
  raw: Record<string, unknown>,
  valueKey: string,
  atKey: string,
  parse: (value: unknown) => T | null,
): ShopPolicyField<T> | undefined {
  if (!(valueKey in raw)) return undefined;
  const value = parse(raw[valueKey]);
  if (value === null) return undefined;
  const updatedAt = String(raw[atKey] ?? "").trim() || EPOCH;
  return { value, updatedAt };
}

export function parseShopPolicyPullPayload(raw: unknown): ShopPolicyCloudDocument | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.ok === false) return null;
  if (o.empty === true) return { empty: true };
  const shopId = typeof o.shop_id === "string" && o.shop_id.trim() ? o.shop_id : undefined;
  return {
    shopId,
    empty: false,
    discountControlMode: fieldFromRaw(o, "discount_control_mode", "discount_control_mode_updated_at", parseDiscountMode),
    discountMaxPercentThreshold: fieldFromRaw(
      o,
      "discount_max_percent_threshold",
      "discount_max_percent_threshold_updated_at",
      parseThreshold,
    ),
    kioskQuickSell: fieldFromRaw(o, "kiosk_quick_sell", "kiosk_quick_sell_updated_at", parseBooleanField),
    staffCanRecordCashExpenses: fieldFromRaw(
      o,
      "staff_can_record_cash_expenses",
      "staff_can_record_cash_expenses_updated_at",
      parseBooleanField,
    ),
    requireCashierExpenseApproval: fieldFromRaw(
      o,
      "require_cashier_expense_approval",
      "require_cashier_expense_approval_updated_at",
      parseBooleanField,
    ),
    registerMode: fieldFromRaw(o, "register_mode", "register_mode_updated_at", parseRegisterMode),
    primaryDeviceFingerprint: fingerprintFieldFromRaw(o),
  };
}

function fingerprintFieldFromRaw(raw: Record<string, unknown>): ShopPolicyField<string | null> | undefined {
  if (!("primary_device_fingerprint" in raw)) return undefined;
  const parsed = parsePrimaryDeviceFingerprint(raw.primary_device_fingerprint);
  if (parsed === undefined) return undefined;
  const updatedAt = String(raw.primary_device_fingerprint_updated_at ?? "").trim() || EPOCH;
  return { value: parsed, updatedAt };
}

function applyField<T>(
  localValue: T,
  localAt: string | undefined,
  remote: ShopPolicyField<T> | undefined,
): { value: T; updatedAt: string | undefined; changed: boolean } {
  if (!remote) return { value: localValue, updatedAt: localAt, changed: false };
  if (!shopPolicyRemoteWins(localAt, remote.updatedAt, localValue, remote.value)) {
    return { value: localValue, updatedAt: localAt, changed: false };
  }
  return { value: remote.value, updatedAt: remote.updatedAt, changed: true };
}

/**
 * Field-aware LWW merge. Missing remote fields leave local values.
 * false/0 overwrite true/nonzero when the remote timestamp wins.
 * Cross-shop payloads are ignored.
 */
export function mergeShopPolicyPreferences(
  local: ShopPreferences,
  remote: ShopPolicyCloudDocument | null | undefined,
  activeShopId?: string | null,
): ShopPreferences {
  if (!remote || remote.empty === true) return local;
  if (remote.shopId && (!activeShopId || remote.shopId !== activeShopId)) return local;

  const rev = { ...(local.shopPolicyRevisions ?? {}) };
  const next: ShopPreferences = { ...local };
  let touched = false;

  const mode = applyField(
    parseDiscountMode(local.discountControlMode) ?? "unrestricted",
    rev.discountControlMode,
    remote.discountControlMode,
  );
  if (mode.changed) {
    next.discountControlMode = mode.value;
    if (mode.updatedAt) rev.discountControlMode = mode.updatedAt;
    touched = true;
  }

  const threshold = applyField(
    parseThreshold(local.discountMaxPercentThreshold) ?? 10,
    rev.discountMaxPercentThreshold,
    remote.discountMaxPercentThreshold,
  );
  if (threshold.changed) {
    next.discountMaxPercentThreshold = threshold.value;
    if (threshold.updatedAt) rev.discountMaxPercentThreshold = threshold.updatedAt;
    touched = true;
  }

  const kiosk = applyField(local.kioskQuickSell === true, rev.kioskQuickSell, remote.kioskQuickSell);
  if (kiosk.changed) {
    next.kioskQuickSell = kiosk.value;
    if (kiosk.updatedAt) rev.kioskQuickSell = kiosk.updatedAt;
    touched = true;
  }

  const staffExp = applyField(
    local.staffCanRecordCashExpenses === true,
    rev.staffCanRecordCashExpenses,
    remote.staffCanRecordCashExpenses,
  );
  if (staffExp.changed) {
    next.staffCanRecordCashExpenses = staffExp.value;
    if (staffExp.updatedAt) rev.staffCanRecordCashExpenses = staffExp.updatedAt;
    touched = true;
  }

  const requireAppr = applyField(
    local.requireCashierExpenseApproval === true,
    rev.requireCashierExpenseApproval,
    remote.requireCashierExpenseApproval,
  );
  if (requireAppr.changed) {
    next.requireCashierExpenseApproval = requireAppr.value;
    if (requireAppr.updatedAt) rev.requireCashierExpenseApproval = requireAppr.updatedAt;
    touched = true;
  }

  const register = applyField(
    parseRegisterMode(local.registerMode) ?? "multi",
    rev.registerMode,
    remote.registerMode,
  );
  if (register.changed) {
    next.registerMode = register.value;
    if (register.updatedAt) rev.registerMode = register.updatedAt;
    touched = true;
  }

  const fingerprint = applyField(
    parsePrimaryDeviceFingerprint(local.primaryDeviceFingerprint ?? null) ?? null,
    rev.primaryDeviceFingerprint,
    remote.primaryDeviceFingerprint,
  );
  if (fingerprint.changed) {
    next.primaryDeviceFingerprint = fingerprint.value;
    if (fingerprint.updatedAt) rev.primaryDeviceFingerprint = fingerprint.updatedAt;
    touched = true;
  }

  if (!touched) return local;
  next.shopPolicyRevisions = rev;
  return next;
}

export function applyShopPolicyDocumentToPreferences(
  prefs: ShopPreferences,
  remote: ShopPolicyCloudDocument | null | undefined,
  activeShopId?: string | null,
): ShopPreferences {
  return mergeShopPolicyPreferences(prefs, remote, activeShopId);
}

function isMissingRpcError(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  return code === "42883" || code === "PGRST202" || code === "42P01";
}

export async function pushShopPolicyToCloud(
  payload: Record<string, unknown>,
  ctx: { shopId: string },
): Promise<{ ok: boolean }> {
  if (!supabase) return { ok: true };
  const { data, error } = await supabase.rpc("shop_push_shop_policy", {
    p_shop_id: ctx.shopId,
    p_payload: payload,
  });
  if (error) {
    if (isMissingRpcError(error)) return { ok: true };
    return { ok: false };
  }
  const result = data as { ok?: boolean } | null;
  return { ok: result?.ok === true };
}

export async function pullShopPolicyFromRpc(
  ctx: { shopId: string },
  since: string | null,
): Promise<{ document: ShopPolicyCloudDocument | null; bytes: number; checkpointAt: string }> {
  const fallback = since ?? EPOCH;
  if (!supabase) {
    return { document: null, bytes: 0, checkpointAt: fallback };
  }
  const { data, error } = await supabase.rpc("shop_pull_shop_policy", {
    p_shop_id: ctx.shopId,
    p_since: since,
  });
  if (error) {
    if (isMissingRpcError(error)) {
      return { document: null, bytes: 0, checkpointAt: fallback };
    }
    throw error;
  }
  const result = data as { ok?: boolean; checkpoint_at?: string; empty?: boolean } | null;
  if (result?.ok === false) {
    throw new Error(String((data as { error?: string })?.error ?? "shop_policy_pull_forbidden"));
  }
  const bytes = JSON.stringify(data ?? {}).length;
  const document = parseShopPolicyPullPayload(data);
  const checkpointAt = String(result?.checkpoint_at ?? fallback);
  return { document, bytes, checkpointAt };
}

export async function processShopPolicySyncOperation(ctx: { shopId: string }): Promise<boolean> {
  const { usePosStore } = await import("../store/usePosStore");
  const prefs = usePosStore.getState().preferences;
  const result = await pushShopPolicyToCloud(buildShopPolicyPushPayload(prefs), ctx);
  if (!result.ok) return false;
  const { scheduleImmediatePull } = await import("./immediateSync");
  scheduleImmediatePull("shop_policy_change");
  return true;
}
