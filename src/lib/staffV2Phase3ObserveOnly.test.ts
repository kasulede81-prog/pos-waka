import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Sale } from "../types";
import { buildPendingSalePushPayload, buildSalePushPayload } from "../offline/cloudSync";

const ROOT = process.cwd();
const CLOUD_SYNC = readFileSync(resolve(ROOT, "src/offline/cloudSync.ts"), "utf8");
const SQL_159 = readFileSync(
  resolve(ROOT, "supabase/migrations/159_staff_v2_sales_identity_observe_only.sql"),
  "utf8",
);
const SESSION_ACTOR = readFileSync(resolve(ROOT, "src/lib/sessionActor.ts"), "utf8");
const USE_AUTH = readFileSync(resolve(ROOT, "src/hooks/useAuth.ts"), "utf8");
const MERGE = readFileSync(resolve(ROOT, "src/lib/saleFinancialMerge.ts"), "utf8");

const OWNER_UUID = "11111111-1111-4111-8111-111111111111";
const SELLER_UUID = "22222222-2222-4222-8222-222222222222";
const STAFF_UUID = "33333333-3333-4333-8333-333333333333";
const CTX = { shopId: "44444444-4444-4444-8444-444444444444", userId: OWNER_UUID };

function sale(soldByUserId: string | null, soldByAuthUserId?: string | null): Sale {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    lines: [],
    totalUgx: 1000,
    subtotalUgx: 1000,
    cashPaidUgx: 1000,
    debtUgx: 0,
    estimatedProfitUgx: 0,
    createdAt: "2026-08-23T10:00:00.000Z",
    soldByUserId,
    soldByAuthUserId: soldByAuthUserId ?? null,
    status: "completed",
    updatedAt: "2026-08-23T10:00:00.000Z",
    pendingSync: true,
  };
}

describe("STAFF-V2 Phase 3 observe-only dual-write (superseded push mapping by Phase 8)", () => {
  it("A. Auth UUID in soldByUserId writes sold_by; created_by is JWT writer (Phase 8)", () => {
    const payload = buildSalePushPayload(sale(SELLER_UUID), CTX);
    expect(payload.sale.created_by).toBe(OWNER_UUID);
    expect(payload.sale.sold_by_user_id).toBe(SELLER_UUID);
  });

  it("B. Owner selling as themselves writes both fields to the owner UUID", () => {
    const payload = buildSalePushPayload(sale(OWNER_UUID), CTX);
    expect(payload.sale.created_by).toBe(OWNER_UUID);
    expect(payload.sale.sold_by_user_id).toBe(OWNER_UUID);
  });

  it("C. PIN seller keeps created_by writer and sold_by null", () => {
    const payload = buildSalePushPayload(sale("staff:cashier-1"), CTX);
    expect(payload.sale.created_by).toBe(OWNER_UUID);
    expect(payload.sale.sold_by_user_id).toBeNull();
  });

  it("D. staff:<uuid> is never written as sold_by_user_id", () => {
    const payload = buildSalePushPayload(sale(`staff:${STAFF_UUID}`), CTX);
    expect(payload.sale.sold_by_user_id).toBeNull();
    expect(payload.sale.sold_by_user_id).not.toBe(STAFF_UUID);
    expect(payload.sale.created_by).toBe(OWNER_UUID);
  });

  it("E. local identity does not write sold_by_user_id", () => {
    const payload = buildSalePushPayload(sale("local:owner@shop.test"), CTX);
    expect(payload.sale.sold_by_user_id).toBeNull();
    expect(payload.sale.created_by).toBe(OWNER_UUID);
  });

  it("F. pending payload uses the same Phase 8 writer/seller split", () => {
    const auth = buildPendingSalePushPayload(sale(SELLER_UUID), CTX);
    expect(auth.sale.created_by).toBe(OWNER_UUID);
    expect(auth.sale.sold_by_user_id).toBe(SELLER_UUID);

    const pin = buildPendingSalePushPayload(sale(`staff:${STAFF_UUID}`), CTX);
    expect(pin.sale.created_by).toBe(OWNER_UUID);
    expect(pin.sale.sold_by_user_id).toBeNull();
  });

  it("G. created_by is always ctx.userId (Phase 8)", () => {
    expect(CLOUD_SYNC).toMatch(/created_by: ctx\.userId/);
    const nullSeller = buildSalePushPayload(sale(null), CTX);
    expect(nullSeller.sale.created_by).toBe(OWNER_UUID);
    expect(nullSeller.sale.sold_by_user_id).toBeNull();
  });

  it("H. Phase 10 pull prefers sold_by_user_id then created_by", () => {
    expect(CLOUD_SYNC).toMatch(/soldByUserId: soldByUserIdFromCloudSaleRow\(row\)/);
    expect(CLOUD_SYNC).toMatch(/soldByAuthUserId: soldByAuthUserIdFromCloudSaleRow\(row\)/);
    expect(MERGE).not.toMatch(/sold_by_user_id/);
  });

  it("I. identity architecture keeps staff: prefix; Phase 3 SQL observe helper intact", () => {
    expect(SESSION_ACTOR).toMatch(/userId: `staff:\$\{params\.staffSession\.staffId\}`/);
    expect(SESSION_ACTOR).toMatch(/const userId = activeStaff \? `staff:\$\{activeStaff\.id\}` : baseUserId;/);
    expect(USE_AUTH).toMatch(/await supabase\.auth\.signOut\(\)/);
    expect(SQL_159).toMatch(/coalesce \(nullif \(v_sale ->> 'created_by', ''\)::uuid, v_uid\)/);
    expect(SQL_159).toMatch(/sold_by_user_id = coalesce \(public\.sales\.sold_by_user_id, excluded\.sold_by_user_id\)/);
    expect(SQL_159).toMatch(/invalid_text_representation/);
    expect(SQL_159).toMatch(/from auth\.users u/);
    expect(SQL_159).not.toMatch(/alter table public\.shop_members/);
    expect(SQL_159).not.toMatch(/create policy/i);
  });
});
