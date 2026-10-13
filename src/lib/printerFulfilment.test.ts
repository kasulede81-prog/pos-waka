/**
 * The printer console's data layer.
 *
 * TWO THINGS THIS GUARDS, and the second matters more than it looks:
 *
 *   1. the pure helpers the screens lean on (serial shape, batch segment, lease
 *      maths, error translation);
 *   2. THE EXACT RPC PARAMETER NAMES. Every call names its parameters
 *      explicitly, and a typo there is not a type error — Supabase resolves
 *      functions by argument name, so a wrong name fails only at runtime in
 *      production. These tests pin the names against the deployed signatures in
 *      `20261013100000_printer_inventory_and_fulfilment.sql`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  calls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  response: { data: null as unknown, error: null as { message: string } | null },
}));

vi.mock("./supabase", () => ({
  supabase: {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      h.calls.push({ fn, args });
      return h.response;
    },
  },
}));

import {
  DEFAULT_PROMOTION_CODE,
  RESERVATION_DAYS,
  assignPrinter,
  ELIGIBILITY_REASON_LABELS,
  batchCodeFromSerial,
  cancelPrinterAssignment,
  daysUntil,
  fetchHandoverHistory,
  fetchMyOrgPrinterStatus,
  fetchPrinterEligibility,
  fetchPrinterInventory,
  requestPrinterCollection,
  mapPrinterError,
  markAssignmentReady,
  recordHandover,
  registerPrinterUnit,
  retirePrinterUnit,
  serialShapeError,
  updatePrinterUnit,
} from "./printerFulfilment";

beforeEach(() => {
  h.calls.length = 0;
  h.response = { data: { ok: true }, error: null };
});

/** The last call's arguments, with keys sorted, for an exact-name comparison. */
function lastCall() {
  const call = h.calls[h.calls.length - 1]!;
  return { fn: call.fn, keys: Object.keys(call.args).sort(), args: call.args };
}

describe("serial and batch helpers", () => {
  it("reads the batch segment of a confirmed-format serial", () => {
    expect(batchCodeFromSerial("WP58-2609-001")).toBe("2609");
    expect(batchCodeFromSerial("  wp58-2701-042  ")).toBe("2701");
  });

  it("returns null for a format it has not been told about", () => {
    // No batch agreement is imposed on a future batch — that is the whole point.
    expect(batchCodeFromSerial("WAKA-WP80-0007")).toBeNull();
    expect(batchCodeFromSerial("")).toBeNull();
  });

  it("accepts a plausible label serial and rejects the rest", () => {
    expect(serialShapeError("WP58-2609-001")).toBeNull();
    expect(serialShapeError("  wp58-2609-001 ")).toBeNull();

    for (const bad of ["", "   ", "AB", "WP58 2609 001", "WP58/2609/001", "WP58-2609-00!"]) {
      expect(serialShapeError(bad), `'${bad}'`).not.toBeNull();
    }
  });
});

describe("lease maths", () => {
  it("counts whole days remaining, and goes negative once lapsed", () => {
    const inTenDays = new Date(Date.now() + 10 * 86_400_000).toISOString();
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    expect(daysUntil(inTenDays)).toBe(10);
    expect(daysUntil(yesterday)).toBeLessThan(0);
    expect(daysUntil(null)).toBeNull();
    expect(daysUntil("not a date")).toBeNull();
  });
});

describe("error translation", () => {
  it("turns every server code into a sentence an operator can act on", () => {
    const codes = [
      "serial_required",
      "serial_malformed",
      "serial_exists",
      "batch_code_mismatch",
      "invalid_condition",
      "unit_assigned",
      "unit_reserved",
      "unit_committed",
      "reason_required",
      "not_eligible",
      "already_assigned",
      "no_unit_available",
      "unit_taken",
      "collection_branch_required",
      "collection_branch_not_organization",
      "recipient_required",
      "invalid_fulfilment_method",
      "already_handed_over",
      "invalid_state",
      "forbidden",
    ];
    for (const code of codes) {
      const message = mapPrinterError(code);
      expect(message, code).not.toBe(code); // never surfaces a raw code
      expect(message.length, code).toBeGreaterThan(15);
    }
  });

  it("explains an unmigrated deployment rather than reporting a crash", () => {
    expect(mapPrinterError("PGRST202")).toMatch(/not available on this deployment/i);
  });

  it("falls back to the raw text for a code it does not know", () => {
    expect(mapPrinterError("some_new_code")).toBe("some_new_code");
    expect(mapPrinterError(null)).toMatch(/failed/i);
  });
});

describe("RPC argument mapping — names must match the deployed signatures", () => {
  it("registers with the label serial, defaulting model and width", async () => {
    await registerPrinterUnit({ serialNumber: " WP58-2609-001 ", batchCode: "2609" });
    const { fn, keys, args } = lastCall();
    expect(fn).toBe("internal_ops_printer_unit_create");
    expect(keys).toEqual([
      "p_batch_code",
      "p_condition",
      "p_held_at_shop_id",
      "p_model",
      "p_notes",
      "p_paper_width_mm",
      "p_serial_number",
    ]);
    expect(args.p_serial_number).toBe("WP58-2609-001");
    expect(args.p_batch_code).toBe("2609");
    expect(args.p_model).toBe("WP-58");
    expect(args.p_paper_width_mm).toBe(58);
    expect(args.p_condition).toBe("new");
  });

  it("sends blank optional fields as null, never as empty strings", async () => {
    await registerPrinterUnit({ serialNumber: "WP58-2609-002", batchCode: "   ", notes: "" });
    const { args } = lastCall();
    expect(args.p_batch_code).toBeNull();
    expect(args.p_notes).toBeNull();
    expect(args.p_held_at_shop_id).toBeNull();
  });

  it("corrects a unit WITHOUT ever sending a serial", async () => {
    await updatePrinterUnit({ unitId: "u1", reason: "label re-read", condition: "refurbished" });
    const { fn, keys, args } = lastCall();
    expect(fn).toBe("internal_ops_printer_unit_update");
    // The serial is not a parameter. There is no way to change it from here.
    expect(keys).toEqual(["p_batch_code", "p_condition", "p_held_at_shop_id", "p_notes", "p_reason", "p_unit_id"]);
    expect(args.p_unit_id).toBe("u1");
    expect(args.p_reason).toBe("label re-read");
  });

  it("retires with a reason", async () => {
    h.response = { data: { ok: true, unit_id: "u1", status: "retired" }, error: null };
    await retirePrinterUnit({ unitId: "u1", reason: "screen cracked" });
    const { fn, keys, args } = lastCall();
    expect(fn).toBe("internal_ops_printer_unit_retire");
    expect(keys).toEqual(["p_reason", "p_unit_id"]);
    expect(args.p_reason).toBe("screen cracked");
  });

  it("assigns with the promotion default and the 14-day window", async () => {
    h.response = { data: { ok: true, assignment_id: "a1", unit_id: "u1", organization_id: "o1", promotion_code: DEFAULT_PROMOTION_CODE, status: "reserved", reserved_until: null }, error: null };
    await assignPrinter({ shopId: "s1" });
    const { fn, keys, args } = lastCall();
    expect(fn).toBe("internal_ops_printer_assign");
    expect(keys).toEqual(["p_promotion_code", "p_reservation_days", "p_shop_id"]);
    expect(args.p_shop_id).toBe("s1");
    expect(args.p_promotion_code).toBe(DEFAULT_PROMOTION_CODE);
    expect(args.p_reservation_days).toBe(RESERVATION_DAYS);
    expect(RESERVATION_DAYS).toBe(14);
  });

  it("marks ready, defaulting the branch to null", async () => {
    h.response = { data: { ok: true, assignment_id: "a1", status: "ready_for_collection" }, error: null };
    await markAssignmentReady({ assignmentId: "a1" });
    const { fn, keys, args } = lastCall();
    expect(fn).toBe("internal_ops_printer_mark_ready");
    expect(keys).toEqual(["p_assignment_id", "p_shop_id"]);
    expect(args.p_shop_id).toBeNull();
  });

  it("records a handover with every required field", async () => {
    h.response = { data: { ok: true, assignment_id: "a1", unit_id: "u1", status: "handed_over", collection_shop_id: "s1" }, error: null };
    await recordHandover({
      assignmentId: "a1",
      collectionShopId: "s1",
      receivedByName: "  Amina Nakato  ",
      fulfilmentMethod: "branch_collection",
      receivedByPhone: "+256700000001",
      evidenceReference: "photo-1.jpg",
      note: "collected in person",
    });
    const { fn, keys, args } = lastCall();
    expect(fn).toBe("internal_ops_printer_handover");
    expect(keys).toEqual([
      "p_assignment_id",
      "p_evidence_reference",
      "p_fulfilment_method",
      "p_note",
      "p_received_by_name",
      "p_received_by_phone",
      "p_shop_id",
    ]);
    expect(args.p_received_by_name).toBe("Amina Nakato");
    expect(args.p_shop_id).toBe("s1");
    expect(args.p_fulfilment_method).toBe("branch_collection");
  });

  it("cancels with a reason", async () => {
    h.response = { data: { ok: true, assignment_id: "a1", status: "cancelled", unit_released: true }, error: null };
    const res = await cancelPrinterAssignment({ assignmentId: "a1", reason: "customer withdrew" });
    const { fn, keys } = lastCall();
    expect(fn).toBe("internal_ops_printer_assignment_cancel");
    expect(keys).toEqual(["p_assignment_id", "p_reason"]);
    expect(res.ok && res.data.unit_released).toBe(true);
  });

  it("reads the inventory with no status filter", async () => {
    h.response = { data: { ok: true, counts: {}, units: [], open_assignments: [], as_of: null }, error: null };
    await fetchPrinterInventory();
    const { fn, keys, args } = lastCall();
    expect(fn).toBe("internal_ops_printer_inventory");
    expect(keys).toEqual(["p_limit", "p_status"]);
    expect(args.p_status).toBeNull();
  });
});

describe("response handling", () => {
  it("maps the inventory payload, tolerating a partial response", async () => {
    h.response = {
      data: {
        ok: true,
        counts: { available: 3, assigned: 1 },
        units: [{ unit_id: "u1", serial_number: "WP58-2609-001" }],
        open_assignments: [{ assignment_id: "a1", serial_number: "WP58-2609-001" }],
        as_of: "2026-10-13T10:00:00Z",
      },
      error: null,
    };
    const res = await fetchPrinterInventory();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.counts.available).toBe(3);
    expect(res.data.units).toHaveLength(1);
    expect(res.data.openAssignments).toHaveLength(1);
    expect(res.data.asOf).toBe("2026-10-13T10:00:00Z");
  });

  it("treats a missing array as empty rather than crashing the screen", async () => {
    h.response = { data: { ok: true }, error: null };
    const res = await fetchPrinterInventory();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.units).toEqual([]);
    expect(res.data.openAssignments).toEqual([]);
  });

  it("surfaces a discriminated refusal as a readable error", async () => {
    h.response = { data: { ok: false, error: "not_eligible" }, error: null };
    const res = await assignPrinter({ shopId: "s1" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/active Business subscription billed yearly/i);
  });

  it("surfaces a transport error as a readable error", async () => {
    h.response = { data: null, error: { message: "permission denied for function internal_ops_printer_assign" } };
    const res = await assignPrinter({ shopId: "s1" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/do not have permission/i);
  });

  it("reports an idempotent retire without pretending it retired again", async () => {
    h.response = { data: { ok: true, idempotent: true, unit_id: "u1" }, error: null };
    const res = await retirePrinterUnit({ unitId: "u1", reason: "already gone" });
    expect(res.ok && res.data.idempotent).toBe(true);
  });
});

describe("read-only additions (20261013110000)", () => {
  it("asks for handover history with its exact parameters", async () => {
    h.response = { data: { ok: true, handovers: [], total: 0, as_of: null }, error: null };
    await fetchHandoverHistory({ limit: 50, organizationId: "o1" });
    const { fn, keys, args } = lastCall();
    expect(fn).toBe("internal_ops_printer_handover_history");
    expect(keys).toEqual(["p_limit", "p_organization_id"]);
    expect(args.p_limit).toBe(50);
    expect(args.p_organization_id).toBe("o1");
  });

  it("defaults the history filter to every account", async () => {
    h.response = { data: { ok: true, handovers: [], total: 0, as_of: null }, error: null };
    await fetchHandoverHistory();
    expect(lastCall().args.p_organization_id).toBeNull();
  });

  it("returns the recorded snapshots, including a detached account", async () => {
    h.response = {
      data: {
        ok: true,
        total: 2,
        as_of: "2026-10-13T12:00:00Z",
        handovers: [
          {
            assignment_id: "a1", unit_id: "u1", serial_number: "WP58-2609-001",
            organization_id: "o1", organization_name: "Kampala Hardware Ltd", account_deleted: false,
            branch_name: "Kampala Main", received_by_name: "Amina Nakato",
            received_by_phone: "+256700000001", fulfilment_method: "branch_collection",
            handed_over_at: "2026-10-12T09:30:00Z", evidence_reference: "photo-1.jpg", note: null,
          },
          {
            assignment_id: "a2", unit_id: "u2", serial_number: "WP58-2609-002",
            organization_id: null, organization_name: "Closed Shop Ltd", account_deleted: true,
            branch_name: "Closed Shop Branch", received_by_name: "John Okello",
            received_by_phone: null, fulfilment_method: "whatsapp_request",
            handed_over_at: "2026-10-01T15:00:00Z", evidence_reference: null, note: "arranged on WhatsApp",
          },
        ],
      },
      error: null,
    };
    const res = await fetchHandoverHistory();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.total).toBe(2);
    expect(res.data.handovers).toHaveLength(2);
    // A deleted account keeps its recorded name and is flagged, not blanked.
    const closed = res.data.handovers[1]!;
    expect(closed.account_deleted).toBe(true);
    expect(closed.organization_id).toBeNull();
    expect(closed.organization_name).toBe("Closed Shop Ltd");
    expect(closed.received_by_name).toBe("John Okello");
  });

  it("treats a missing handover array as empty", async () => {
    h.response = { data: { ok: true }, error: null };
    const res = await fetchHandoverHistory();
    expect(res.ok && res.data.handovers).toEqual([]);
  });

  it("previews eligibility with its exact parameters", async () => {
    h.response = { data: { ok: true, eligible: true, can_reserve: true, reason: null }, error: null };
    await fetchPrinterEligibility({ shopId: "s1" });
    const { fn, keys, args } = lastCall();
    expect(fn).toBe("internal_ops_printer_eligibility");
    expect(keys).toEqual(["p_promotion_code", "p_shop_id"]);
    expect(args.p_shop_id).toBe("s1");
    expect(args.p_promotion_code).toBe(DEFAULT_PROMOTION_CODE);
  });

  it("carries the server verdict and its explanation through unchanged", async () => {
    h.response = {
      data: {
        ok: true, shop_id: "s1", shop_name: "Test Shop", shop_active: true,
        organization_id: "o1", subscription_id: "sub1",
        plan_code: "business", subscription_status: "trialing", billing_interval: "month",
        current_period_end: "2026-11-01T00:00:00Z", promotion_code: DEFAULT_PROMOTION_CODE,
        eligible: false, reason: "not_annual", open_claim: null, can_reserve: false,
      },
      error: null,
    };
    const res = await fetchPrinterEligibility({ shopId: "s1" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // The frontend does NOT re-decide: it reports what the server said, and the
    // reason explains it.
    expect(res.data.eligible).toBe(false);
    expect(res.data.can_reserve).toBe(false);
    expect(res.data.reason).toBe("not_annual");
    expect(ELIGIBILITY_REASON_LABELS[res.data.reason!]).toMatch(/yearly billing/i);
  });

  it("reports an existing claim separately from eligibility", async () => {
    h.response = {
      data: {
        ok: true, eligible: true, can_reserve: false, reason: null,
        open_claim: { assignment_id: "a1", status: "reserved", serial_number: "WP58-2609-001", reserved_until: null },
      },
      error: null,
    };
    const res = await fetchPrinterEligibility({ shopId: "s1" });
    expect(res.ok && res.data.can_reserve).toBe(false);
    expect(res.ok && res.data.eligible).toBe(true);
    expect(res.ok && res.data.open_claim?.serial_number).toBe("WP58-2609-001");
  });

  it("surfaces a refusal from the eligibility RPC", async () => {
    h.response = { data: { ok: false, error: "shop_not_found" }, error: null };
    const res = await fetchPrinterEligibility({ shopId: "nope" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/could not be found/i);
  });
});

// ---------------------------------------------------------------------------
// CUSTOMER side (20261013140000)
// ---------------------------------------------------------------------------
describe("customer printer reads and requests", () => {
  it("reads the customer status RPC with its exact parameter name", async () => {
    h.response = { data: { ok: true, eligible: true, can_request: true, requests: [] }, error: null };

    const res = await fetchMyOrgPrinterStatus({ shopId: "shop-1" });

    expect(lastCall().fn).toBe("my_org_printer_status");
    expect(lastCall().keys).toEqual(["p_shop_id"]);
    expect(lastCall().args.p_shop_id).toBe("shop-1");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.eligible).toBe(true);
  });

  it("asks to collect with all four parameters named exactly", async () => {
    h.response = { data: { ok: true, request_id: "req-1", status: "requested" }, error: null };

    const res = await requestPrinterCollection({ shopId: "shop-1", channel: "branch" });

    expect(lastCall().fn).toBe("my_org_printer_request_collection");
    expect(lastCall().keys).toEqual(["p_channel", "p_contact_phone", "p_note", "p_shop_id"]);
    expect(lastCall().args.p_channel).toBe("branch");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.requestId).toBe("req-1");
  });

  it("sends blank optional fields as null, never as empty strings", async () => {
    h.response = { data: { ok: true, request_id: "req-1" }, error: null };

    await requestPrinterCollection({ shopId: "shop-1", channel: "whatsapp", contactPhone: "   ", note: "" });

    expect(lastCall().args.p_contact_phone).toBeNull();
    expect(lastCall().args.p_note).toBeNull();
  });

  it("reports a second ask as already open rather than a new request", async () => {
    h.response = { data: { ok: true, request_id: "req-1", already_open: true }, error: null };

    const res = await requestPrinterCollection({ shopId: "shop-1", channel: "branch" });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.alreadyOpen).toBe(true);
      expect(res.data.requestId).toBe("req-1");
    }
  });

  it("surfaces a server refusal as a readable sentence", async () => {
    h.response = { data: { ok: false, error: "already_assigned" }, error: null };

    const res = await requestPrinterCollection({ shopId: "shop-1", channel: "branch" });

    expect(res.ok).toBe(false);
    // The merchant reads a sentence, never the raw code.
    if (!res.ok) expect(res.error).toBe("This account already has a printer for this promotion.");
  });

  it("turns the customer-only refusal codes into sentences", () => {
    expect(mapPrinterError("shop_required")).toMatch(/choose which shop/i);
    expect(mapPrinterError("invalid_channel")).toMatch(/how you would like to collect/i);
    expect(mapPrinterError("unauthenticated")).toMatch(/sign in again/i);
    // ...and none of them leak the raw code through.
    for (const code of ["shop_required", "invalid_channel", "unauthenticated"]) {
      expect(mapPrinterError(code)).not.toBe(code);
    }
  });
});
