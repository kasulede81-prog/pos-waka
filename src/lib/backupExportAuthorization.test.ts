import { describe, expect, it } from "vitest";
import type { SessionActor } from "./sessionActor";
import { authorizeBackupExport } from "./backupExportAuthorization";
import type { RemoteSubscriptionRow, SubscriptionSnapshot } from "./subscriptionEntitlements";

function actor(role: SessionActor["role"]): SessionActor {
  return { userId: "user-1", role, displayName: "Test" };
}

function remote(row: Partial<RemoteSubscriptionRow> & Pick<RemoteSubscriptionRow, "plan_code" | "status">): SubscriptionSnapshot {
  return {
    kind: "remote",
    row: {
      id: "1",
      organization_id: "o1",
      shop_id: "s1",
      trial_ends_at: null,
      current_period_start: null,
      current_period_end: null,
      max_pos_users: null,
      max_shops: null,
      max_devices: null,
      ...row,
    } as RemoteSubscriptionRow,
  };
}

describe("backupExportAuthorization", () => {
  it("allows owner on starter tier or above", () => {
    const snap = remote({ plan_code: "starter", status: "active" });
    expect(authorizeBackupExport({ actor: actor("owner"), snapshot: snap, authMode: "supabase" })).toEqual({
      ok: true,
    });
    expect(
      authorizeBackupExport({ actor: actor("owner"), snapshot: remote({ plan_code: "business", status: "active" }), authMode: "supabase" }),
    ).toEqual({ ok: true });
  });

  it("allows local mode regardless of snapshot", () => {
    expect(
      authorizeBackupExport({ actor: actor("owner"), snapshot: { kind: "none" }, authMode: "local" }),
    ).toEqual({ ok: true });
  });

  it("denies free tier on supabase", () => {
    const snap = remote({ plan_code: "free", status: "active" });
    expect(authorizeBackupExport({ actor: actor("owner"), snapshot: snap, authMode: "supabase" })).toEqual({
      ok: false,
      errorKey: "forbidden",
    });
  });

  it("denies cashier even on paid tier", () => {
    const snap = remote({ plan_code: "business", status: "active" });
    expect(authorizeBackupExport({ actor: actor("cashier"), snapshot: snap, authMode: "supabase" })).toEqual({
      ok: false,
      errorKey: "forbidden",
    });
  });

  it("denies manager on paid tier (no settings.shop)", () => {
    const snap = remote({ plan_code: "business", status: "active" });
    expect(authorizeBackupExport({ actor: actor("manager"), snapshot: snap, authMode: "supabase" })).toEqual({
      ok: false,
      errorKey: "forbidden",
    });
  });

  it("denies when actor is null", () => {
    const snap = remote({ plan_code: "starter", status: "active" });
    expect(authorizeBackupExport({ actor: null, snapshot: snap, authMode: "supabase" })).toEqual({
      ok: false,
      errorKey: "noSelection",
    });
  });
});
