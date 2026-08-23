import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Sale } from "../types";
import {
  buildPendingSalePushPayload,
  buildSalePushPayload,
  resolveSoldByAuthUserIdForPush,
} from "../offline/cloudSync";
import {
  commercialAuthUserIdFromActor,
  normalizeLinkedAuthUserId,
  resolveSessionActor,
} from "./sessionActor";
import { computeAccountKey } from "../offline/accountScope";

const ROOT = process.cwd();
const SQL_163 = readFileSync(
  resolve(ROOT, "supabase/migrations/163_staff_v2_shared_terminal_link.sql"),
  "utf8",
);
const SQL_162 = readFileSync(
  resolve(ROOT, "supabase/migrations/162_staff_v2_seller_validation.sql"),
  "utf8",
);
const CLOUD_SYNC = readFileSync(resolve(ROOT, "src/offline/cloudSync.ts"), "utf8");
const SESSION_ACTOR = readFileSync(resolve(ROOT, "src/lib/sessionActor.ts"), "utf8");
const USE_AUTH = readFileSync(resolve(ROOT, "src/hooks/useAuth.ts"), "utf8");
const STAFF_CLOUD = readFileSync(resolve(ROOT, "src/lib/shopStaffCloud.ts"), "utf8");
const STAFF_CACHE = readFileSync(resolve(ROOT, "src/lib/staffCacheSync.ts"), "utf8");

const OWNER_UUID = "11111111-1111-4111-8111-111111111111";
const CASHIER_UUID = "22222222-2222-4222-8222-222222222222";
const STAFF_ROW_ID = "33333333-3333-4333-8333-333333333333";
const CTX = { shopId: "44444444-4444-4444-8444-444444444444", userId: OWNER_UUID };

function sale(partial: Partial<Sale> & { soldByUserId?: string | null }): Sale {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    lines: [],
    totalUgx: 1000,
    subtotalUgx: 1000,
    cashPaidUgx: 1000,
    debtUgx: 0,
    estimatedProfitUgx: 0,
    createdAt: "2026-08-23T10:00:00.000Z",
    status: "completed",
    updatedAt: "2026-08-23T10:00:00.000Z",
    pendingSync: true,
    soldByUserId: partial.soldByUserId ?? null,
    soldByAuthUserId: partial.soldByAuthUserId ?? null,
    ...partial,
  };
}

describe("STAFF-V2 Phase 8 shared terminal PIN attribution", () => {
  it("163 exposes user_id on staff download/list without rewriting Phase 7", () => {
    expect(SQL_163).toMatch(/'user_id', s\.user_id/);
    expect(SQL_163).toMatch(/shop_pos_staff_download/);
    expect(SQL_163).toMatch(/shop_pos_staff_list/);
    expect(SQL_163).not.toMatch(/staff_v2_validate_sold_by_user_id/);
    expect(SQL_163).not.toMatch(/alter table public\.sales/i);
    expect(SQL_162).toMatch(/staff_v2_validate_sold_by_user_id/);
  });

  it("maps cloud user_id into StaffAccount.linkedAuthUserId", () => {
    expect(STAFF_CLOUD).toMatch(/linkedAuthUserId: row\.user_id \?\? null/);
    expect(STAFF_CACHE).toMatch(/linkedAuthUserId: row\.user_id \?\? null/);
  });

  it("P1 linked PIN: writer stays JWT owner; sold_by is linked Auth UUID", () => {
    const payload = buildSalePushPayload(
      sale({
        soldByUserId: `staff:${STAFF_ROW_ID}`,
        soldByAuthUserId: CASHIER_UUID,
      }),
      CTX,
    );
    expect(payload.sale.created_by).toBe(OWNER_UUID);
    expect(payload.sale.sold_by_user_id).toBe(CASHIER_UUID);
  });

  it("P2 legacy PIN: sold_by null; created_by writer", () => {
    const payload = buildSalePushPayload(
      sale({ soldByUserId: `staff:${STAFF_ROW_ID}`, soldByAuthUserId: null }),
      CTX,
    );
    expect(payload.sale.created_by).toBe(OWNER_UUID);
    expect(payload.sale.sold_by_user_id).toBeNull();
  });

  it("P3 offline stamp: soldByAuthUserId survives for later sync", () => {
    expect(resolveSoldByAuthUserIdForPush(sale({
      soldByUserId: `staff:${STAFF_ROW_ID}`,
      soldByAuthUserId: CASHIER_UUID,
    }))).toBe(CASHIER_UUID);
    const pending = buildPendingSalePushPayload(
      sale({ soldByUserId: `staff:${STAFF_ROW_ID}`, soldByAuthUserId: CASHIER_UUID }),
      CTX,
    );
    expect(pending.sale.created_by).toBe(OWNER_UUID);
    expect(pending.sale.sold_by_user_id).toBe(CASHIER_UUID);
  });

  it("P5 accountKey stays owner ledger on PIN actor", () => {
    const ownerKey = computeAccountKey({ mode: "supabase", userId: OWNER_UUID });
    const cashierKey = computeAccountKey({ mode: "supabase", userId: CASHIER_UUID });
    expect(ownerKey).toBe(`sb:${OWNER_UUID}`);
    expect(ownerKey).not.toBe(cashierKey);
    expect(SESSION_ACTOR).toMatch(/userId: `staff:\$\{params\.staffSession\.staffId\}`/);
    expect(SESSION_ACTOR).toMatch(/linkedAuthUserId/);
    expect(USE_AUTH).toMatch(/await supabase\.auth\.signOut\(\)/);
  });

  it("Path S actor exposes linkedAuthUserId without replacing staff: userId", () => {
    const actor = resolveSessionActor({
      mode: "supabase",
      user: { id: OWNER_UUID, email: "owner@waka.invalid" } as never,
      email: "owner@waka.invalid",
      shopMemberRole: "owner",
      preferences: {
        activeStaffId: STAFF_ROW_ID,
        staffAccounts: [
          {
            id: STAFF_ROW_ID,
            name: "John",
            role: "cashier",
            active: true,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            linkedAuthUserId: CASHIER_UUID,
          },
        ],
      } as never,
    });
    expect(actor.userId).toBe(`staff:${STAFF_ROW_ID}`);
    expect(actor.linkedAuthUserId).toBe(CASHIER_UUID);
    expect(commercialAuthUserIdFromActor(actor)).toBe(CASHIER_UUID);
    expect(normalizeLinkedAuthUserId("staff:x")).toBeNull();
  });

  it("Auth cashier UUID soldByUserId still attributes sold_by; created_by is ctx writer", () => {
    const cashierCtx = { ...CTX, userId: CASHIER_UUID };
    const payload = buildSalePushPayload(sale({ soldByUserId: CASHIER_UUID }), cashierCtx);
    expect(payload.sale.created_by).toBe(CASHIER_UUID);
    expect(payload.sale.sold_by_user_id).toBe(CASHIER_UUID);
  });

  it("keeps push frozen; Phase 10 remaps rowToSale seller from sold_by", () => {
    expect(CLOUD_SYNC).toMatch(/soldByUserId: soldByUserIdFromCloudSaleRow\(row\)/);
    expect(CLOUD_SYNC).toMatch(/created_by: ctx\.userId/);
    expect(CLOUD_SYNC).toMatch(/sold_by_user_id: resolveSoldByAuthUserIdForPush\(sale\)/);
    expect(SQL_162).toMatch(/inner join public\.shop_members sm/);
  });
});
