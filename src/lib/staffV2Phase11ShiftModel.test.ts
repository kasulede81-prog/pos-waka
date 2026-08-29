import { describe, expect, it } from "vitest";
import { buildSalePushPayload } from "../offline/cloudSync";
import type { Sale } from "../types";
import { actorHasPermission } from "./actorAuthorization";
import {
  getActiveShiftForActor,
  rekeySharedTerminalOpenShifts,
  requireActiveShift,
} from "./shiftEnforcement";
import {
  commercialAuthUserIdFromActor,
  resolveSessionActor,
  shiftOwnerUserId,
} from "./sessionActor";
import { usePosStore } from "../store/usePosStore";

const OWNER_UUID = "11111111-1111-4111-8111-111111111111";
const CASHIER_UUID = "22222222-2222-4222-8222-222222222222";
const STAFF_JOHN = "33333333-3333-4333-8333-333333333333";
const STAFF_MARY = "44444444-4444-4444-8444-444444444444";
const CTX = { shopId: "55555555-5555-4555-8555-555555555555", userId: OWNER_UUID };

function staffPrefs(activeStaffId: string) {
  return {
    activeStaffId,
    staffAccounts: [
      {
        id: STAFF_JOHN,
        name: "John",
        role: "cashier" as const,
        active: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        linkedAuthUserId: CASHIER_UUID,
      },
      {
        id: STAFF_MARY,
        name: "Mary",
        role: "cashier" as const,
        active: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        linkedAuthUserId: "66666666-6666-4666-8666-666666666666",
      },
    ],
  };
}

function ownerActor(activeStaffId: string | null) {
  return resolveSessionActor({
    mode: "supabase",
    user: { id: OWNER_UUID, email: "owner@waka.invalid" } as never,
    email: "owner@waka.invalid",
    shopMemberRole: "owner",
    preferences: staffPrefs(activeStaffId ?? "") as never,
  });
}

function sale(partial: Partial<Sale>): Sale {
  return {
    id: "77777777-7777-4777-8777-777777777777",
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
    soldByUserId: `staff:${STAFF_JOHN}`,
    soldByAuthUserId: CASHIER_UUID,
    ...partial,
  };
}

describe("STAFF-V2 Phase 11b writer-keyed shift model", () => {
  it("A — owner only: shift keyed to owner UUID", () => {
    const actor = ownerActor(null);
    expect(shiftOwnerUserId(actor)).toBe(OWNER_UUID);
    const shifts = [
      {
        id: "shift-1",
        actorUserId: OWNER_UUID,
        role: "owner" as const,
        startAt: "2026-08-23T08:00:00.000Z",
        endAt: null,
        salesTotalUgx: 0,
        debtTotalUgx: 0,
        refundsUgx: 0,
        estimatedCashUgx: 0,
      },
    ];
    expect(getActiveShiftForActor(shifts, shiftOwnerUserId(actor)!)?.id).toBe("shift-1");
  });

  it("B — owner → John: same writer shift", () => {
    const owner = ownerActor(null);
    const john = ownerActor(STAFF_JOHN);
    const shifts = [
      {
        id: "shift-1",
        actorUserId: OWNER_UUID,
        role: "owner" as const,
        startAt: "2026-08-23T08:00:00.000Z",
        endAt: null,
        salesTotalUgx: 0,
        debtTotalUgx: 0,
        refundsUgx: 0,
        estimatedCashUgx: 0,
      },
    ];
    expect(getActiveShiftForActor(shifts, shiftOwnerUserId(owner)!)?.id).toBe("shift-1");
    expect(getActiveShiftForActor(shifts, shiftOwnerUserId(john)!)?.id).toBe("shift-1");
    expect(john.userId).toBe(`staff:${STAFF_JOHN}`);
  });

  it("C — John sells: cloud writer/seller unchanged; shift stays owner", () => {
    const john = ownerActor(STAFF_JOHN);
    const payload = buildSalePushPayload(sale({}), CTX);
    expect(payload.sale.created_by).toBe(OWNER_UUID);
    expect(payload.sale.sold_by_user_id).toBe(CASHIER_UUID);
    expect(commercialAuthUserIdFromActor(john)).toBe(CASHIER_UUID);
    const guard = requireActiveShift({
      sessionActor: john,
      preferences: {
        shifts: [
          {
            id: "shift-1",
            actorUserId: OWNER_UUID,
            role: "owner",
            startAt: "2026-08-23T08:00:00.000Z",
            endAt: null,
            salesTotalUgx: 0,
            debtTotalUgx: 0,
            refundsUgx: 0,
            estimatedCashUgx: 0,
          },
        ],
      },
    });
    expect(guard.ok).toBe(true);
  });

  it("D — John → Mary: one shift, two sellers", () => {
    usePosStore.setState({
      _hydrated: true,
      sessionActor: ownerActor(STAFF_JOHN),
      preferences: {
        ...usePosStore.getState().preferences,
        ...staffPrefs(STAFF_JOHN),
        shifts: [
          {
            id: "shift-1",
            actorUserId: OWNER_UUID,
            role: "owner",
            startAt: "2026-08-23T08:00:00.000Z",
            endAt: null,
            salesTotalUgx: 0,
            debtTotalUgx: 0,
            refundsUgx: 0,
            estimatedCashUgx: 0,
          },
        ],
      },
    });
    const toMary = usePosStore.getState().switchStaffAccount(STAFF_MARY);
    expect(toMary.ok).toBe(true);
    const guard = requireActiveShift({
      sessionActor: ownerActor(STAFF_MARY),
      preferences: usePosStore.getState().preferences,
    });
    expect(guard.ok).toBe(true);
    expect(usePosStore.getState().preferences.shifts?.filter((s) => !s.endAt)).toHaveLength(1);
  });

  it("E — return to owner seller: no switch block with open writer shift", () => {
    usePosStore.setState({
      _hydrated: true,
      sessionActor: ownerActor(STAFF_JOHN),
      preferences: {
        ...usePosStore.getState().preferences,
        activeStaffId: STAFF_JOHN,
        shifts: [
          {
            id: "shift-1",
            actorUserId: OWNER_UUID,
            role: "owner",
            startAt: "2026-08-23T08:00:00.000Z",
            endAt: null,
            salesTotalUgx: 0,
            debtTotalUgx: 0,
            refundsUgx: 0,
            estimatedCashUgx: 0,
          },
        ],
      },
    });
    const back = usePosStore.getState().switchStaffAccount(null);
    expect(back.ok).toBe(true);
    const guard = requireActiveShift({
      sessionActor: ownerActor(null),
      preferences: usePosStore.getState().preferences,
    });
    expect(guard.ok).toBe(true);
  });

  it("F — legacy PIN: no crash; seller null on push", () => {
    const legacy = ownerActor(STAFF_JOHN);
    const legacyActor = {
      ...legacy,
      linkedAuthUserId: null,
    };
    const payload = buildSalePushPayload(
      sale({ soldByAuthUserId: null, soldByUserId: `staff:${STAFF_JOHN}` }),
      CTX,
    );
    expect(payload.sale.created_by).toBe(OWNER_UUID);
    expect(payload.sale.sold_by_user_id).toBeNull();
    expect(actorHasPermission(legacyActor, "settings.shop")).toBe(false);
  });

  it("rekeys orphaned staff: open shift to writer UUID", () => {
    const shifts = [
      {
        id: "shift-legacy",
        actorUserId: `staff:${STAFF_JOHN}`,
        role: "cashier" as const,
        startAt: "2026-08-23T08:00:00.000Z",
        endAt: null,
        salesTotalUgx: 0,
        debtTotalUgx: 0,
        refundsUgx: 0,
        estimatedCashUgx: 0,
      },
    ];
    const next = rekeySharedTerminalOpenShifts(shifts, OWNER_UUID);
    expect(next?.[0]?.actorUserId).toBe(OWNER_UUID);
  });
});
