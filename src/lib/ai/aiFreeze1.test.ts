import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canUseAi } from "./canUseAi";
import {
  COMING_SOON_AI_FEATURES,
  LIVE_AI_FEATURES,
  isLiveAiFeature,
} from "./aiFeatures";
import {
  DEFAULT_AI_PLAN_LIMITS,
  mapWakaPlanToAiPlanCode,
  resolveAiPlanRequestLimit,
} from "./aiPlanEntitlements";
import { DEFAULT_PLATFORM_AI_SETTINGS_V2 } from "./platformAiSettings.v2";
import { canManageAi } from "../../components/internal-admin/v2/adminRoles";

describe("AI-FREEZE-1 live vs coming soon", () => {
  it("lists only deployed Edge features as live", () => {
    expect([...LIVE_AI_FEATURES]).toEqual([
      "ask_waka",
      "product_assistant",
      "inventory_assistant",
      "business_setup_assistant",
    ]);
    expect(COMING_SOON_AI_FEATURES).toContain("marketing_assistant");
    expect(COMING_SOON_AI_FEATURES).toContain("product_scanner");
    expect(isLiveAiFeature("ask_waka")).toBe(true);
    expect(isLiveAiFeature("ocr")).toBe(false);
  });

  it("fails closed when the platform master switch is off", () => {
    const r = canUseAi("ask_waka", {
      settings: { ...DEFAULT_PLATFORM_AI_SETTINGS_V2, ask_waka: true },
    });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe("ai_platform_disabled");
  });
});

describe("AI-FREEZE-1 plan entitlements (AUTH-1 keys)", () => {
  it("maps WAKA billing plans onto AI plan_limits keys", () => {
    expect(mapWakaPlanToAiPlanCode("free")).toBe("free");
    expect(mapWakaPlanToAiPlanCode("starter")).toBe("starter");
    expect(mapWakaPlanToAiPlanCode("business")).toBe("business");
    expect(mapWakaPlanToAiPlanCode("waka_plus")).toBe("enterprise");
  });

  it("resolves stored plan_limits", () => {
    expect(resolveAiPlanRequestLimit("free")).toBe(DEFAULT_AI_PLAN_LIMITS.free);
    expect(resolveAiPlanRequestLimit("standard")).toBe(500);
    expect(resolveAiPlanRequestLimit("enterprise")).toBeNull();
  });
});

describe("AI-FREEZE-1 permission alignment", () => {
  it("uses the same roles as admin_update_platform_ai_settings", () => {
    expect(canManageAi("super_admin")).toBe(true);
    expect(canManageAi("operations_admin")).toBe(true);
    expect(canManageAi("support_admin")).toBe(false);
  });
});

describe("AI-FREEZE-1 SQL control plane", () => {
  it("tightens shop_ai_settings writes and live-feature RPC", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "supabase/migrations/156_ai_freeze1_control_plane.sql"),
      "utf8",
    );
    expect(sql).toContain("shop_ai_settings_staff_read");
    expect(sql).toContain("revoke insert, update, delete on table public.shop_ai_settings");
    expect(sql).toContain("ai_is_live_feature");
    expect(sql).toContain("feature_not_deployed");
    expect(sql).toContain("marketing_assistant = false");
    expect(sql).toContain("by_error");
    expect(sql).not.toContain("openai");
  });
});
