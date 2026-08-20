import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEFAULT_AI_ROLE_ACCESS,
  isAiRoleAuthorized,
  mapShopRoleToAiRoleBucket,
  parseAiRoleAccess,
} from "./aiAuthorization";
import { canUseAi } from "./canUseAi";
import {
  DEFAULT_AI_PLAN_LIMITS,
  mapWakaPlanToAiPlanCode,
  parseAiPlanLimits,
  resolveAiPlanRequestLimit,
} from "./aiPlanEntitlements";
import { DEFAULT_PLATFORM_AI_SETTINGS_V2, parsePlatformAiSettingsV2 } from "./platformAiSettings.v2";
import { parseShopAiSettings } from "./shopAiSettings";

const platformOn = {
  ...DEFAULT_PLATFORM_AI_SETTINGS_V2,
  enabled: true,
  product_assistant: true,
  inventory_assistant: true,
  ask_waka: true,
  business_setup_assistant: true,
};

function authorizedShop(overrides: Record<string, unknown> = {}) {
  return parseShopAiSettings(
    {
      shop_id: "s1",
      ai_enabled: true,
      product_assistant: true,
      inventory_assistant: true,
      ask_waka: true,
      business_setup_assistant: true,
      ...overrides,
    },
    "s1",
  );
}

describe("AI-AUTH-1 role buckets", () => {
  it("maps shop roles onto owner / manager / cashier", () => {
    expect(mapShopRoleToAiRoleBucket("owner")).toBe("owner");
    expect(mapShopRoleToAiRoleBucket("manager")).toBe("manager");
    expect(mapShopRoleToAiRoleBucket("supervisor")).toBe("manager");
    expect(mapShopRoleToAiRoleBucket("cashier")).toBe("cashier");
    expect(mapShopRoleToAiRoleBucket("stock_keeper")).toBe("cashier");
    expect(mapShopRoleToAiRoleBucket(null)).toBe("cashier");
  });

  it("authorizes owner and manager by default, not cashier", () => {
    expect(isAiRoleAuthorized("owner")).toBe(true);
    expect(isAiRoleAuthorized("manager")).toBe(true);
    expect(isAiRoleAuthorized("cashier")).toBe(false);
    expect(parseAiRoleAccess(undefined)).toEqual(DEFAULT_AI_ROLE_ACCESS);
    expect(parseAiRoleAccess({ owner: false, manager: true, cashier: true }).owner).toBe(false);
  });
});

describe("AI-AUTH-1 shop fail-closed", () => {
  it("denies when the shop row is missing", () => {
    const r = canUseAi("product_assistant", {
      settings: platformOn,
      shopSettings: null,
      userRole: "owner",
    });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe("shop_not_authorized");
  });

  it("denies when the shop is not authorized", () => {
    const r = canUseAi("product_assistant", {
      settings: platformOn,
      shopSettings: authorizedShop({ ai_enabled: false }),
      userRole: "owner",
    });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe("shop_ai_disabled");
  });

  it("allows an authorized shop for owner", () => {
    const r = canUseAi("product_assistant", {
      settings: platformOn,
      shopSettings: authorizedShop(),
      userRole: "owner",
    });
    expect(r.allowed).toBe(true);
  });
});

describe("AI-AUTH-1 user role", () => {
  it("blocks cashier by default", () => {
    const r = canUseAi("ask_waka", {
      settings: platformOn,
      shopSettings: authorizedShop(),
      userRole: "cashier",
    });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe("user_not_authorized");
  });

  it("allows manager by default", () => {
    expect(
      canUseAi("inventory_assistant", {
        settings: platformOn,
        shopSettings: authorizedShop(),
        userRole: "manager",
      }).allowed,
    ).toBe(true);
  });

  it("allows cashier only when role_access.cashier is on", () => {
    const r = canUseAi("product_assistant", {
      settings: { ...platformOn, role_access: { owner: true, manager: true, cashier: true } },
      shopSettings: authorizedShop(),
      userRole: "cashier",
    });
    expect(r.allowed).toBe(true);
  });
});

describe("AI-AUTH-1 plan caps", () => {
  it("maps WAKA billing plans onto free/starter/business/enterprise", () => {
    expect(mapWakaPlanToAiPlanCode("free")).toBe("free");
    expect(mapWakaPlanToAiPlanCode("starter")).toBe("starter");
    expect(mapWakaPlanToAiPlanCode("standard")).toBe("starter");
    expect(mapWakaPlanToAiPlanCode("business")).toBe("business");
    expect(mapWakaPlanToAiPlanCode("premium")).toBe("business");
    expect(mapWakaPlanToAiPlanCode("waka_plus")).toBe("enterprise");
    expect(resolveAiPlanRequestLimit("free")).toBe(50);
    expect(resolveAiPlanRequestLimit("starter")).toBe(500);
    expect(resolveAiPlanRequestLimit("business")).toBe(5000);
    expect(resolveAiPlanRequestLimit("enterprise")).toBeNull();
  });

  it("reads legacy standard/premium keys", () => {
    const limits = parseAiPlanLimits({ free: 50, standard: 400, premium: 4000, enterprise: null });
    expect(limits.starter).toBe(400);
    expect(limits.business).toBe(4000);
    expect(limits.enterprise).toBeNull();
  });

  it("blocks when the shop hits the plan cap", () => {
    const r = canUseAi("product_assistant", {
      settings: platformOn,
      shopSettings: authorizedShop(),
      userRole: "owner",
      wakaPlanCode: "free",
      usage: { shopRequests: 50 },
    });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe("plan_limit_reached");
  });
});

describe("AI-AUTH-1 platform JSON", () => {
  it("defaults role_access to owner/manager on and cashier off", () => {
    const parsed = parsePlatformAiSettingsV2({});
    expect(parsed.role_access).toEqual(DEFAULT_AI_ROLE_ACCESS);
    expect(parsed.plan_limits).toEqual(DEFAULT_AI_PLAN_LIMITS);
  });
});

describe("AI-AUTH-1 SQL control plane", () => {
  it("fail-closes missing shops, checks shop_members, and enforces plan caps", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "supabase/migrations/157_ai_auth1_controlled_access.sql"),
      "utf8",
    );
    expect(sql).toContain("shop_not_authorized");
    expect(sql).toContain("user_not_authorized");
    expect(sql).toContain("plan_limit_reached");
    expect(sql).toContain("role_access");
    expect(sql).toContain("from public.shop_members sm");
    expect(sql).toContain("shop_effective_plan_code");
    expect(sql).toContain("v_enabled := case when v_pilot then v_auto else false end");
    expect(sql).toContain("admin_ai_authorization_snapshot");
    expect(sql).not.toContain("and sas.ai_enabled = false");
  });
});
