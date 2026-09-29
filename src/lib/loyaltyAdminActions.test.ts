import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 6C — client action layer for the internal Loyalty control plane.
 *
 * The RPCs are the authority (see loyaltyAdminActions.sql.integration.test.ts). These tests
 * hold the client half: it calls only the four approved RPCs with the right arguments, never
 * reports a refused or unknown outcome as success, validates reasons and plan drafts the
 * same way the server does, and the UI files contain no direct table access or client-side
 * audit writes.
 */

const rpc = vi.hoisted(() => ({ fn: vi.fn() }));

vi.mock("./supabase", () => ({
  hasSupabaseConfig: true,
  supabase: { rpc: rpc.fn },
}));

import {
  createLoyaltyPlan,
  describeLoyaltyAdminError,
  setLoyaltyPlanActive,
  setShopLoyaltyEntitlement,
  shopsOverProposedLimit,
  updateLoyaltyPlan,
  validateAdminReason,
  validatePlanDraft,
  type LoyaltyPlanDraft,
} from "./loyaltyAdminActions";
import type { LoyaltyAdminShopState } from "./loyaltyAdmin";

const REASON = "Merchant upgraded — ticket 42";
const draft: LoyaltyPlanDraft = {
  code: " Gold_2 ",
  name: " Gold ",
  memberLimit: 200,
  monthlyPriceUgx: 25000,
  annualPriceUgx: 250000,
  sortOrder: 5,
};

beforeEach(() => {
  rpc.fn.mockReset();
});

describe("reason validation", () => {
  it("requires a meaningful reason within bounds", () => {
    expect(validateAdminReason("")).toMatch(/required/);
    expect(validateAdminReason("   ")).toMatch(/required/);
    expect(validateAdminReason("fix")).toMatch(/at least/);
    expect(validateAdminReason("x".repeat(301))).toMatch(/under 300/);
    expect(validateAdminReason("  Merchant asked for upgrade  ")).toBeNull();
  });
});

describe("plan draft validation mirrors the server", () => {
  it("accepts a valid draft and flags each invalid field", () => {
    expect(validatePlanDraft(draft, "create")).toEqual({});
    const bad = validatePlanDraft(
      { code: "9bad code", name: "", memberLimit: -1, monthlyPriceUgx: -5, annualPriceUgx: Number.NaN, sortOrder: 1.5 },
      "create",
    );
    expect(Object.keys(bad).sort()).toEqual(["annualPriceUgx", "code", "memberLimit", "monthlyPriceUgx", "name", "sortOrder"]);
  });

  it("does not validate the (immutable) code when editing", () => {
    expect(validatePlanDraft({ ...draft, code: "Legacy Code" }, "edit")).toEqual({});
  });
});

describe("mutations call only the approved RPCs with normalized arguments", () => {
  it("create / update send the trimmed plan and reason", async () => {
    rpc.fn.mockResolvedValue({ data: { ok: true, code: "gold_2", member_limit_changed: false }, error: null });
    const created = await createLoyaltyPlan(draft, `  ${REASON}  `);
    expect(created).toEqual({ ok: true, data: { code: "gold_2", memberLimitChanged: false } });
    expect(rpc.fn).toHaveBeenCalledWith("internal_ops_loyalty_create_plan", {
      p_code: "gold_2",
      p_name: "Gold",
      p_member_limit: 200,
      p_monthly_price_ugx: 25000,
      p_annual_price_ugx: 250000,
      p_sort_order: 5,
      p_reason: REASON,
    });

    rpc.fn.mockResolvedValue({ data: { ok: true, code: "gold_2", member_limit_changed: true }, error: null });
    const updated = await updateLoyaltyPlan(draft, REASON);
    expect(updated).toEqual({ ok: true, data: { code: "gold_2", memberLimitChanged: true } });
    expect(rpc.fn.mock.calls[1]![0]).toBe("internal_ops_loyalty_update_plan");
  });

  it("set-active and entitlement map enable / disable correctly", async () => {
    rpc.fn.mockResolvedValue({ data: { ok: true, code: "gold" }, error: null });
    await setLoyaltyPlanActive("gold", false, REASON);
    expect(rpc.fn).toHaveBeenLastCalledWith("internal_ops_loyalty_set_plan_active", {
      p_code: "gold",
      p_is_active: false,
      p_reason: REASON,
    });

    rpc.fn.mockResolvedValue({
      data: { ok: true, organization_id: "org-1", loyalty_enabled: true, tier_code: "gold", member_limit: 200 },
      error: null,
    });
    const on = await setShopLoyaltyEntitlement("shop-1", { enabled: true, planCode: "gold" }, REASON);
    expect(on).toEqual({ ok: true, data: { organizationId: "org-1", loyaltyEnabled: true, tierCode: "gold", memberLimit: 200 } });
    expect(rpc.fn).toHaveBeenLastCalledWith("internal_ops_loyalty_set_shop_entitlement", {
      p_shop_id: "shop-1",
      p_status: "active",
      p_plan_code: "gold",
      p_reason: REASON,
    });

    rpc.fn.mockResolvedValue({
      data: { ok: true, organization_id: "org-1", loyalty_enabled: false, tier_code: "gold", member_limit: 0 },
      error: null,
    });
    await setShopLoyaltyEntitlement("shop-1", { enabled: false }, REASON);
    expect(rpc.fn).toHaveBeenLastCalledWith("internal_ops_loyalty_set_shop_entitlement", {
      p_shop_id: "shop-1",
      p_status: "none",
      p_plan_code: null,
      p_reason: REASON,
    });
  });
});

describe("a refused or unknown outcome is never reported as success", () => {
  it("surfaces the server's structured error code and details", async () => {
    rpc.fn.mockResolvedValue({ data: { ok: false, error: "tier_in_use", organizations: 3 }, error: null });
    const r = await setLoyaltyPlanActive("gold", false, REASON);
    expect(r).toEqual({ ok: false, error: "tier_in_use", details: { organizations: 3 } });
    expect(describeLoyaltyAdminError("tier_in_use", { organizations: 3 })).toMatch(/3 organization/);
  });

  it("treats a missing ok flag, a permission error, a transport error and a throw as failures", async () => {
    rpc.fn.mockResolvedValue({ data: { code: "gold" }, error: null });
    expect((await createLoyaltyPlan(draft, REASON)).ok).toBe(false);

    rpc.fn.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied for function" } });
    expect(await createLoyaltyPlan(draft, REASON)).toEqual({ ok: false, error: "forbidden" });

    rpc.fn.mockResolvedValue({ data: null, error: { code: "PGRST", message: "boom" } });
    expect(await createLoyaltyPlan(draft, REASON)).toEqual({ ok: false, error: "rpc_failed" });

    rpc.fn.mockRejectedValue(new Error("offline"));
    expect(await createLoyaltyPlan(draft, REASON)).toEqual({ ok: false, error: "network" });
  });

  it("has a human message for every error code the 6A RPCs return", () => {
    const generic = describeLoyaltyAdminError("__unknown__");
    for (const code of [
      "forbidden",
      "reason_required",
      "invalid_code",
      "code_exists",
      "invalid_name",
      "invalid_member_limit",
      "invalid_price",
      "tier_not_found",
      "tier_inactive",
      "tier_is_default",
      "tier_in_use",
      "last_active_tier",
      "invalid_state",
      "invalid_status",
      "invalid_shop",
      "shop_not_found",
    ]) {
      expect(describeLoyaltyAdminError(code), code).not.toBe(generic);
    }
  });
});

describe("impact helper for the confirmation screens", () => {
  const shop = (over: Partial<LoyaltyAdminShopState>): LoyaltyAdminShopState => ({
    shopId: "s",
    shopName: "S",
    shopNumber: null,
    organizationId: "o",
    organizationName: "O",
    publicCode: "WPL2026001",
    loyaltyEnabled: true,
    entitlementStatus: "active",
    tierCode: "gold",
    tierName: "Gold",
    memberLimit: 100,
    activeMembers: 0,
    remaining: 0,
    overLimit: false,
    pendingRequests: 0,
    ...over,
  });

  it("lists enabled shops on the plan (including default-fallback shops) that exceed the proposed limit", () => {
    const rows = [
      shop({ shopId: "a", activeMembers: 12 }),
      shop({ shopId: "b", activeMembers: 30 }),
      shop({ shopId: "c", activeMembers: 5 }),
      shop({ shopId: "d", activeMembers: 50, tierCode: "silver" }),
      shop({ shopId: "e", activeMembers: 50, loyaltyEnabled: false }),
      shop({ shopId: "f", activeMembers: 20, tierCode: null }),
    ];
    expect(shopsOverProposedLimit(rows, { code: "gold", isDefault: false }, 10).map((s) => [s.shopId, s.overBy])).toEqual([
      ["b", 20],
      ["a", 2],
    ]);
    expect(shopsOverProposedLimit(rows, { code: "gold", isDefault: true }, 10).map((s) => s.shopId)).toEqual(["b", "f", "a"]);
  });
});

describe("no direct browser writes and no client-side audit", () => {
  const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
  const files = {
    actions: read("src", "lib", "loyaltyAdminActions.ts"),
    page: read("src", "components", "internal-admin", "v2", "pages", "AdminLoyaltyPage.tsx"),
    dialogs: read("src", "components", "internal-admin", "v2", "pages", "AdminLoyaltyActions.tsx"),
  };

  it("the action layer uses only the four approved mutation RPCs", () => {
    expect(files.actions).not.toMatch(/\.from\(/);
    const called = [...files.actions.matchAll(/"(internal_ops_[a-z_]+|loyalty_[a-z_]+)"/g)].map((m) => m[1]);
    expect(new Set(called)).toEqual(
      new Set([
        "internal_ops_loyalty_create_plan",
        "internal_ops_loyalty_update_plan",
        "internal_ops_loyalty_set_plan_active",
        "internal_ops_loyalty_set_shop_entitlement",
      ]),
    );
  });

  it("the UI never talks to the database directly and never writes audit rows", () => {
    for (const [name, src] of Object.entries(files)) {
      expect(src, name).not.toContain("internal_ops_admin_audit");
      for (const table of ["loyalty_accounts", "loyalty_transactions", "loyalty_plan_tiers", "organization_feature_entitlements"]) {
        expect(src, `${name} → ${table}`).not.toContain(table);
      }
    }
    for (const src of [files.page, files.dialogs]) {
      expect(src).not.toMatch(/\.from\(|\.rpc\(|from "\.\.\/\.\.\/\.\.\/\.\.\/lib\/supabase"/);
      // No member / points / Wallet mutation path is reachable from the control plane UI.
      for (const banned of ["loyalty_adjust_points", "loyalty_set_account_lifecycle", "delete", "wallet_object"]) {
        expect(src.toLowerCase()).not.toContain(banned);
      }
    }
  });

  it("action controls are gated by the same allowlist as the server", () => {
    const roles = read("src", "components", "internal-admin", "v2", "adminRoles.ts");
    const fn = roles.slice(roles.indexOf("export function canManageLoyalty"));
    expect(fn.slice(0, fn.indexOf("}"))).toMatch(/role === "super_admin" \|\| role === "operations_admin"/);
    expect(files.page).toContain("canManageLoyalty(actingRole)");
  });
});
