/**
 * Platform subscription settings — Phase 17.4
 * Central configuration for trials, durations, grace, and reminders.
 */

import { supabase } from "./supabase";
import type { AdminPlanCode } from "./subscriptionEngine";

export type PlatformSubscriptionSettings = {
  automaticTrialEnabled: boolean;
  defaultTrialPlan: AdminPlanCode;
  defaultTrialDurationDays: number;
  monthlyDurationDays: number;
  yearlyDurationDays: number;
  gracePeriodDays: number;
  allowPromotionalGrants: boolean;
  allowMultipleTrials: boolean;
  requireVerifiedEmailBeforeTrial: boolean;
  subscriptionReminderDays: number[];
};

export const DEFAULT_PLATFORM_SUBSCRIPTION_SETTINGS: PlatformSubscriptionSettings = {
  automaticTrialEnabled: true,
  defaultTrialPlan: "business",
  defaultTrialDurationDays: 14,
  monthlyDurationDays: 30,
  yearlyDurationDays: 365,
  gracePeriodDays: 0,
  allowPromotionalGrants: true,
  allowMultipleTrials: false,
  requireVerifiedEmailBeforeTrial: false,
  subscriptionReminderDays: [7, 3, 1],
};

const LOCAL_KEY = "waka_platform_subscription_settings_v1";
let cached: PlatformSubscriptionSettings | null = null;
let cacheAt = 0;
const CACHE_MS = 60_000;

function clampDays(n: unknown, min = 1, max = 3650): number {
  const num = Math.floor(Number(n));
  if (!Number.isFinite(num)) return min;
  return Math.min(max, Math.max(min, num));
}

function parseReminderDays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return DEFAULT_PLATFORM_SUBSCRIPTION_SETTINGS.subscriptionReminderDays;
  const nums = raw.map((v) => Math.floor(Number(v))).filter((n) => n > 0 && n <= 365);
  return nums.length ? [...new Set(nums)].sort((a, b) => b - a) : DEFAULT_PLATFORM_SUBSCRIPTION_SETTINGS.subscriptionReminderDays;
}

export function parsePlatformSubscriptionSettings(raw: unknown): PlatformSubscriptionSettings {
  const d = DEFAULT_PLATFORM_SUBSCRIPTION_SETTINGS;
  if (!raw || typeof raw !== "object") return { ...d };
  const o = raw as Record<string, unknown>;
  const plan = String(o.defaultTrialPlan ?? d.defaultTrialPlan);
  const defaultTrialPlan: AdminPlanCode =
    plan === "starter" || plan === "business" || plan === "waka_plus" || plan === "free" ? plan : d.defaultTrialPlan;
  return {
    automaticTrialEnabled: o.automaticTrialEnabled !== false,
    defaultTrialPlan,
    defaultTrialDurationDays: clampDays(o.defaultTrialDurationDays ?? d.defaultTrialDurationDays),
    monthlyDurationDays: clampDays(o.monthlyDurationDays ?? d.monthlyDurationDays),
    yearlyDurationDays: clampDays(o.yearlyDurationDays ?? d.yearlyDurationDays, 30, 3650),
    gracePeriodDays: clampDays(o.gracePeriodDays ?? d.gracePeriodDays, 0, 90),
    allowPromotionalGrants: o.allowPromotionalGrants !== false,
    allowMultipleTrials: o.allowMultipleTrials === true,
    requireVerifiedEmailBeforeTrial: o.requireVerifiedEmailBeforeTrial === true,
    subscriptionReminderDays: parseReminderDays(o.subscriptionReminderDays),
  };
}

function readLocalSettings(): PlatformSubscriptionSettings {
  if (typeof localStorage === "undefined") return { ...DEFAULT_PLATFORM_SUBSCRIPTION_SETTINGS };
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return { ...DEFAULT_PLATFORM_SUBSCRIPTION_SETTINGS };
    return parsePlatformSubscriptionSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PLATFORM_SUBSCRIPTION_SETTINGS };
  }
}

function writeLocalSettings(settings: PlatformSubscriptionSettings): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(LOCAL_KEY, JSON.stringify(settings));
}

export type PlatformSubscriptionSettingsResult = {
  settings: PlatformSubscriptionSettings;
  fromServer: boolean;
};

export async function fetchPlatformSubscriptionSettings(force = false): Promise<PlatformSubscriptionSettingsResult> {
  const now = Date.now();
  if (!force && cached && now - cacheAt < CACHE_MS) {
    return { settings: cached, fromServer: true };
  }

  if (!supabase) {
    cached = readLocalSettings();
    cacheAt = now;
    return { settings: cached, fromServer: false };
  }

  const { data, error } = await supabase.rpc("get_platform_subscription_settings");
  if (error || !data) {
    cached = readLocalSettings();
    cacheAt = now;
    return { settings: cached, fromServer: false };
  }

  cached = parsePlatformSubscriptionSettings(data);
  cacheAt = now;
  return { settings: cached, fromServer: true };
}

export async function adminUpdatePlatformSubscriptionSettings(
  settings: PlatformSubscriptionSettings,
): Promise<{ ok: boolean; message?: string }> {
  const parsed = parsePlatformSubscriptionSettings(settings);
  if (!supabase) {
    writeLocalSettings(parsed);
    cached = parsed;
    cacheAt = Date.now();
    invalidatePlatformSubscriptionSettingsCache();
    return { ok: true };
  }

  const { data, error } = await supabase.rpc("admin_update_platform_subscription_settings", {
    p_settings: parsed,
  });
  if (error) {
    const missingFn = error.message?.includes("Could not find the function") || error.code === "PGRST202";
    if (missingFn) {
      writeLocalSettings(parsed);
      cached = parsed;
      cacheAt = Date.now();
      invalidatePlatformSubscriptionSettingsCache();
      return { ok: true, message: "Saved locally — apply migration 135 for server persistence." };
    }
    return { ok: false, message: error.message };
  }
  const j = (data ?? {}) as { ok?: boolean; error?: string };
  if (j.ok !== true) return { ok: false, message: j.error ?? "Update failed." };
  cached = parsed;
  cacheAt = Date.now();
  invalidatePlatformSubscriptionSettingsCache();
  return { ok: true };
}

export function invalidatePlatformSubscriptionSettingsCache(): void {
  cached = null;
  cacheAt = 0;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("waka:platform-subscription-settings-changed"));
  }
}

/** Resolve grant duration from platform settings + billing cycle hint. */
export function resolveGrantDurationDays(
  settings: PlatformSubscriptionSettings,
  billingCycle: "monthly" | "yearly" | "trial" | "custom" | null,
  overrideDays?: number | null,
): number {
  if (overrideDays != null && overrideDays > 0) return clampDays(overrideDays);
  if (billingCycle === "yearly") return settings.yearlyDurationDays;
  if (billingCycle === "monthly") return settings.monthlyDurationDays;
  if (billingCycle === "trial") return settings.defaultTrialDurationDays;
  return settings.monthlyDurationDays;
}
