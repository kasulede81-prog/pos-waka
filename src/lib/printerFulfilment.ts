/**
 * Data access for the printer inventory and fulfilment console.
 *
 * EVERY FUNCTION HERE CALLS AN EXISTING RPC. Nothing composes its own SQL, reads
 * a table directly, or re-derives a business rule — the server owns eligibility,
 * allocation, the 14-day lease and the handover state machine, and this module
 * only carries those answers to the screen.
 *
 * The signatures below were read from `20261013100000_printer_inventory_and_fulfilment.sql`,
 * not assumed. Where a return field does not exist, it is not typed here.
 */
import { supabase } from "./supabase";

/** Mirrors the `status` CHECK on `waka_printer_units`. */
export const PRINTER_STATUSES = ["available", "reserved", "assigned", "damaged", "retired"] as const;
export type PrinterStatus = (typeof PRINTER_STATUSES)[number];

/** Mirrors the `condition` CHECK. `retired` is only ever set by the retire RPC. */
export const PRINTER_CONDITIONS = ["new", "refurbished", "damaged"] as const;
export type PrinterCondition = (typeof PRINTER_CONDITIONS)[number];

/** Mirrors the `fulfilment_method` CHECK. */
export const FULFILMENT_METHODS = ["branch_collection", "whatsapp_request", "dispatched"] as const;
export type FulfilmentMethod = (typeof FULFILMENT_METHODS)[number];

/** The promotion a claim is made against; the RPC's own default. */
export const DEFAULT_PROMOTION_CODE = "business_annual_printer_v1";

/** The approved reservation window, as the RPC defaults to. */
export const RESERVATION_DAYS = 14;

export const PRINTER_STATUS_LABELS: Record<PrinterStatus, string> = {
  available: "Available",
  reserved: "Reserved",
  assigned: "Handed over",
  damaged: "Damaged",
  retired: "Retired",
};

export const FULFILMENT_METHOD_LABELS: Record<FulfilmentMethod, string> = {
  branch_collection: "Branch collection",
  whatsapp_request: "WhatsApp request",
  dispatched: "Dispatched",
};

export const ASSIGNMENT_STATUS_LABELS: Record<string, string> = {
  reserved: "Reserved",
  ready_for_collection: "Ready for collection",
  handed_over: "Handed over",
  cancelled: "Cancelled",
  failed_collection: "Collection lapsed",
};

// ---------------------------------------------------------------------------
// Result envelope
// ---------------------------------------------------------------------------

export type RpcOutcome<T> = { ok: true; data: T } | { ok: false; error: string };

type Envelope = {
  ok?: boolean;
  error?: string;
  idempotent?: boolean;
  [key: string]: unknown;
};

/**
 * Every printer RPC answers either a discriminated `{ok:false,error}` or a
 * transport-level PostgREST error. Both become one readable sentence; a raw
 * code is never shown to an operator.
 */
export function mapPrinterError(code: string | null | undefined): string {
  const raw = (code ?? "").trim();
  const lower = raw.toLowerCase();

  if (!raw) return "The request failed. Nothing was changed.";

  if (lower.includes("forbidden") || lower.includes("permission denied")) {
    return "You do not have permission to manage printers.";
  }
  if (lower.includes("pgrst202") || lower.includes("could not find the function")) {
    return "Printer management is not available on this deployment yet. The printer migrations have not been applied.";
  }

  switch (raw) {
    // ---- registration / stock ----
    case "serial_required":
      return "Enter the serial number printed on the printer's label.";
    case "serial_malformed":
      return "That serial does not look like a label serial. Use uppercase letters, digits and hyphens — for example WP58-2609-001.";
    case "serial_exists":
      return "That serial is already registered. Each physical printer can only be registered once.";
    case "batch_code_mismatch":
      return "The batch code does not match the serial. Check both against the label — they must agree.";
    case "invalid_condition":
      return "Choose a valid condition.";
    case "invalid_paper_width":
      return "Enter a valid paper width in millimetres.";
    case "invalid_status":
      return "That filter is not a valid printer status.";
    case "unit_not_found":
      return "That printer is no longer in the inventory. Refresh the list.";
    case "unit_assigned":
      return "This printer has been handed to a customer, so its details can no longer be edited.";
    case "unit_reserved":
      return "This printer is reserved for a customer. Cancel the claim before marking it damaged.";
    case "unit_committed":
      return "This printer is reserved or already handed over. Resolve that first.";
    case "reason_required":
      return "Give a reason of at least 3 characters. It is kept in the audit trail.";

    // ---- assignment ----
    case "shop_not_found":
      return "That shop could not be found.";
    case "shop_not_active":
      return "That shop is not active, so a printer cannot be issued from it.";
    case "subscription_not_found":
      return "That shop's account has no subscription, so it cannot qualify.";
    case "not_eligible":
      return "Not eligible. The promotion requires an active Business subscription billed yearly.";
    case "already_assigned":
      return "This account already has a printer for this promotion.";
    case "no_unit_available":
      return "No printers are available. Register a unit before assigning one.";
    case "unit_taken":
      return "That printer was claimed a moment ago. Try again — another unit may be free.";
    case "assignment_not_found":
      return "That claim no longer exists. Refresh the list.";

    // ---- handover ----
    case "collection_branch_required":
      return "Choose the branch the customer is collecting from.";
    case "collection_branch_not_organization":
      return "That branch belongs to a different account. The printer must be collected from the customer's own branch.";
    case "recipient_required":
      return "Enter the name of the person receiving the printer.";
    case "invalid_fulfilment_method":
      return "Choose how the printer is being handed over.";
    case "already_handed_over":
      return "This printer has already been handed over. A completed handover cannot be changed or cancelled.";
    case "invalid_state":
      return "This claim is not in a state that allows that action. Refresh to see its current status.";

    // ---- customer-facing collection requests ----
    // These reach the merchant, not the desk, so they say what the merchant can
    // do next rather than naming an internal state.
    case "shop_required":
      return "Choose which shop this is for.";
    case "invalid_channel":
      return "Choose how you would like to collect the printer.";
    case "unauthenticated":
      return "Please sign in again to continue.";

    default:
      return raw;
  }
}

function unwrap(data: unknown, error: { message: string } | null): Envelope {
  if (error) return { ok: false, error: mapPrinterError(error.message) };
  const envelope = (data ?? {}) as Envelope;
  if (envelope.ok === false) {
    return { ...envelope, error: mapPrinterError(envelope.error) };
  }
  return envelope;
}

// ---------------------------------------------------------------------------
// Shapes returned by the deployed RPCs
// ---------------------------------------------------------------------------

export type PrinterUnit = {
  unit_id: string;
  serial_number: string;
  model: string;
  paper_width_mm: number;
  batch_code: string | null;
  condition: string;
  status: string;
  held_at_shop_id: string | null;
  /** Added by 20261013110000; null when the branch no longer exists. */
  held_at_shop_name?: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type OpenAssignment = {
  assignment_id: string;
  status: string;
  unit_id: string;
  serial_number: string;
  organization_id: string;
  /** Added by 20261013110000 — the account and branch behind those ids. */
  organization_name?: string | null;
  shop_id: string | null;
  shop_name?: string | null;
  promotion_code: string;
  reserved_until: string | null;
  created_at: string;
};

export type PrinterInventory = {
  counts: Partial<Record<PrinterStatus, number>>;
  units: PrinterUnit[];
  openAssignments: OpenAssignment[];
  asOf: string | null;
};

export type UnitCreateResult = { unit_id: string; serial_number: string; status: string };
export type AssignResult = {
  assignment_id: string;
  unit_id: string;
  organization_id: string;
  promotion_code: string;
  status: string;
  reserved_until: string | null;
};
export type HandoverResult = {
  assignment_id: string;
  unit_id: string;
  status: string;
  collection_shop_id: string;
};

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Inventory, counts, and the OPEN assignments the console acts on.
 *
 * NOTE ON HANDOVER HISTORY: this RPC returns `open_assignments` only — reserved
 * and ready_for_collection. Completed handovers are read separately, through
 * `fetchHandoverHistory` below (`internal_ops_printer_handover_history`, added in
 * 20261013110000_printer_read_rpcs.sql), which is what the History panel renders.
 *
 * The call also reclaims lapsed reservations server-side before answering, so a
 * "reserved" row it returns is genuinely still held.
 */
export async function fetchPrinterInventory(): Promise<RpcOutcome<PrinterInventory>> {
  if (!supabase) return { ok: false, error: "Not configured for this build." };

  const { data, error } = await supabase.rpc("internal_ops_printer_inventory", {
    p_status: null,
    p_limit: 500,
  });
  const envelope = unwrap(data, error);
  if (envelope.ok !== true) {
    return { ok: false, error: String(envelope.error ?? "The printer inventory could not be loaded.") };
  }
  return {
    ok: true,
    data: {
      counts: (envelope.counts ?? {}) as PrinterInventory["counts"],
      units: Array.isArray(envelope.units) ? (envelope.units as PrinterUnit[]) : [],
      openAssignments: Array.isArray(envelope.open_assignments)
        ? (envelope.open_assignments as OpenAssignment[])
        : [],
      asOf: typeof envelope.as_of === "string" ? envelope.as_of : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Stock — server gate is `super_admin | operations_admin`
// ---------------------------------------------------------------------------

export async function registerPrinterUnit(input: {
  serialNumber: string;
  batchCode?: string | null;
  heldAtShopId?: string | null;
  notes?: string | null;
  model?: string;
  paperWidthMm?: number;
  condition?: PrinterCondition;
}): Promise<RpcOutcome<UnitCreateResult>> {
  if (!supabase) return { ok: false, error: "Not configured for this build." };

  const { data, error } = await supabase.rpc("internal_ops_printer_unit_create", {
    p_serial_number: input.serialNumber.trim(),
    p_batch_code: input.batchCode?.trim() ? input.batchCode.trim() : null,
    p_held_at_shop_id: input.heldAtShopId ?? null,
    p_notes: input.notes?.trim() ? input.notes.trim() : null,
    p_model: input.model?.trim() ? input.model.trim() : "WP-58",
    p_paper_width_mm: input.paperWidthMm ?? 58,
    p_condition: input.condition ?? "new",
  });
  const envelope = unwrap(data, error);
  if (envelope.ok !== true) {
    return { ok: false, error: String(envelope.error ?? "The printer could not be registered.") };
  }
  return {
    ok: true,
    data: {
      unit_id: String(envelope.unit_id),
      serial_number: String(envelope.serial_number),
      status: String(envelope.status),
    },
  };
}

/** The serial is NOT a parameter — the RPC cannot change it, and neither can this. */
export async function updatePrinterUnit(input: {
  unitId: string;
  reason: string;
  condition?: PrinterCondition | null;
  batchCode?: string | null;
  heldAtShopId?: string | null;
  notes?: string | null;
}): Promise<RpcOutcome<{ unit_id: string }>> {
  if (!supabase) return { ok: false, error: "Not configured for this build." };

  const { data, error } = await supabase.rpc("internal_ops_printer_unit_update", {
    p_unit_id: input.unitId,
    p_reason: input.reason.trim(),
    p_condition: input.condition ?? null,
    p_batch_code: input.batchCode?.trim() ? input.batchCode.trim() : null,
    p_held_at_shop_id: input.heldAtShopId ?? null,
    p_notes: input.notes?.trim() ? input.notes.trim() : null,
  });
  const envelope = unwrap(data, error);
  if (envelope.ok !== true) {
    return { ok: false, error: String(envelope.error ?? "The printer could not be updated.") };
  }
  return { ok: true, data: { unit_id: String(envelope.unit_id) } };
}

export async function retirePrinterUnit(input: {
  unitId: string;
  reason: string;
}): Promise<RpcOutcome<{ unit_id: string; idempotent: boolean }>> {
  if (!supabase) return { ok: false, error: "Not configured for this build." };

  const { data, error } = await supabase.rpc("internal_ops_printer_unit_retire", {
    p_unit_id: input.unitId,
    p_reason: input.reason.trim(),
  });
  const envelope = unwrap(data, error);
  if (envelope.ok !== true) {
    return { ok: false, error: String(envelope.error ?? "The printer could not be retired.") };
  }
  return {
    ok: true,
    data: { unit_id: String(envelope.unit_id), idempotent: envelope.idempotent === true },
  };
}

// ---------------------------------------------------------------------------
// Fulfilment — server gate is `super_admin | subscriptions_admin | operations_admin`
// ---------------------------------------------------------------------------

/**
 * Claim a printer for a shop's organization.
 *
 * `p_shop_id` identifies the ACCOUNT to check eligibility for — the server
 * resolves it to the organization and reads that organization's subscription.
 * Eligibility is never decided here.
 */
export async function assignPrinter(input: {
  shopId: string;
  promotionCode?: string;
  reservationDays?: number;
}): Promise<RpcOutcome<AssignResult>> {
  if (!supabase) return { ok: false, error: "Not configured for this build." };

  const { data, error } = await supabase.rpc("internal_ops_printer_assign", {
    p_shop_id: input.shopId,
    p_promotion_code: input.promotionCode?.trim() ? input.promotionCode.trim() : DEFAULT_PROMOTION_CODE,
    p_reservation_days: input.reservationDays ?? RESERVATION_DAYS,
  });
  const envelope = unwrap(data, error);
  if (envelope.ok !== true) {
    return { ok: false, error: String(envelope.error ?? "The printer could not be assigned.") };
  }
  return {
    ok: true,
    data: {
      assignment_id: String(envelope.assignment_id),
      unit_id: String(envelope.unit_id),
      organization_id: String(envelope.organization_id),
      promotion_code: String(envelope.promotion_code),
      status: String(envelope.status),
      reserved_until: typeof envelope.reserved_until === "string" ? envelope.reserved_until : null,
    },
  };
}

export async function markAssignmentReady(input: {
  assignmentId: string;
  shopId?: string | null;
}): Promise<RpcOutcome<{ assignment_id: string; status: string }>> {
  if (!supabase) return { ok: false, error: "Not configured for this build." };

  const { data, error } = await supabase.rpc("internal_ops_printer_mark_ready", {
    p_assignment_id: input.assignmentId,
    p_shop_id: input.shopId ?? null,
  });
  const envelope = unwrap(data, error);
  if (envelope.ok !== true) {
    return { ok: false, error: String(envelope.error ?? "The claim could not be marked ready.") };
  }
  return {
    ok: true,
    data: { assignment_id: String(envelope.assignment_id), status: String(envelope.status) },
  };
}

/**
 * Record an ACTUAL handover. The branch is required and must belong to the
 * assignment's own organization — the server enforces both.
 */
export async function recordHandover(input: {
  assignmentId: string;
  collectionShopId: string;
  receivedByName: string;
  fulfilmentMethod: FulfilmentMethod;
  receivedByPhone?: string | null;
  evidenceReference?: string | null;
  note?: string | null;
}): Promise<RpcOutcome<HandoverResult>> {
  if (!supabase) return { ok: false, error: "Not configured for this build." };

  const { data, error } = await supabase.rpc("internal_ops_printer_handover", {
    p_assignment_id: input.assignmentId,
    p_shop_id: input.collectionShopId,
    p_received_by_name: input.receivedByName.trim(),
    p_fulfilment_method: input.fulfilmentMethod,
    p_received_by_phone: input.receivedByPhone?.trim() ? input.receivedByPhone.trim() : null,
    p_evidence_reference: input.evidenceReference?.trim() ? input.evidenceReference.trim() : null,
    p_note: input.note?.trim() ? input.note.trim() : null,
  });
  const envelope = unwrap(data, error);
  if (envelope.ok !== true) {
    return { ok: false, error: String(envelope.error ?? "The handover could not be recorded.") };
  }
  return {
    ok: true,
    data: {
      assignment_id: String(envelope.assignment_id),
      unit_id: String(envelope.unit_id),
      status: String(envelope.status),
      collection_shop_id: String(envelope.collection_shop_id),
    },
  };
}

/**
 * Cancel an UNFULFILLED claim. The server refuses on a handed-over claim, and
 * returns `idempotent: true` if it was already terminal.
 */
export async function cancelPrinterAssignment(input: {
  assignmentId: string;
  reason: string;
}): Promise<RpcOutcome<{ assignment_id: string; status: string; unit_released: boolean }>> {
  if (!supabase) return { ok: false, error: "Not configured for this build." };

  const { data, error } = await supabase.rpc("internal_ops_printer_assignment_cancel", {
    p_assignment_id: input.assignmentId,
    p_reason: input.reason.trim(),
  });
  const envelope = unwrap(data, error);
  if (envelope.ok !== true) {
    return { ok: false, error: String(envelope.error ?? "The claim could not be cancelled.") };
  }
  return {
    ok: true,
    data: {
      assignment_id: String(envelope.assignment_id),
      status: String(envelope.status),
      unit_released: envelope.unit_released === true,
    },
  };
}

// ---------------------------------------------------------------------------
// Completed handovers
// ---------------------------------------------------------------------------

export type HandoverRecord = {
  assignment_id: string;
  unit_id: string;
  serial_number: string;
  model: string;
  /**
   * The account and branch as they were named at handover. These are SNAPSHOTS,
   * not live joins: the record survives the account being deleted.
   */
  organization_id: string | null;
  organization_name: string | null;
  /** True when the account has since been deleted and the row is detached. */
  account_deleted: boolean;
  shop_id: string | null;
  branch_name: string | null;
  promotion_code: string;
  fulfilment_method: string | null;
  received_by_name: string | null;
  received_by_phone: string | null;
  evidence_reference: string | null;
  note: string | null;
  handed_over_at: string | null;
  handed_over_by: string | null;
  subscription_id: string | null;
};

export type HandoverHistory = { handovers: HandoverRecord[]; total: number; asOf: string | null };

export async function fetchHandoverHistory(input?: {
  limit?: number;
  organizationId?: string | null;
}): Promise<RpcOutcome<HandoverHistory>> {
  if (!supabase) return { ok: false, error: "Not configured for this build." };

  const { data, error } = await supabase.rpc("internal_ops_printer_handover_history", {
    p_limit: input?.limit ?? 100,
    p_organization_id: input?.organizationId ?? null,
  });
  const envelope = unwrap(data, error);
  if (envelope.ok !== true) {
    return { ok: false, error: String(envelope.error ?? "The handover history could not be loaded.") };
  }
  return {
    ok: true,
    data: {
      handovers: Array.isArray(envelope.handovers) ? (envelope.handovers as HandoverRecord[]) : [],
      total: typeof envelope.total === "number" ? envelope.total : 0,
      asOf: typeof envelope.as_of === "string" ? envelope.as_of : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Eligibility preview — read-only, reserves nothing
// ---------------------------------------------------------------------------

export type EligibilityPreview = {
  shop_id: string;
  shop_name: string | null;
  shop_active: boolean;
  organization_id: string;
  subscription_id: string | null;
  plan_code: string | null;
  subscription_status: string | null;
  billing_interval: string | null;
  current_period_end: string | null;
  promotion_code: string;
  /** THE VERDICT, from the same predicate the reservation uses. */
  eligible: boolean;
  /** An explanation of that verdict — never the decision itself. */
  reason: string | null;
  open_claim: {
    assignment_id: string;
    status: string;
    serial_number: string;
    reserved_until: string | null;
  } | null;
  can_reserve: boolean;
};

/** Wording for the server's explanation codes. */
export const ELIGIBILITY_REASON_LABELS: Record<string, string> = {
  shop_not_active: "That branch is not active.",
  no_subscription: "The account has no subscription at all.",
  subscription_not_active: "The subscription is not active — a trial or a lapsed plan does not qualify.",
  not_annual: "The subscription is billed monthly. The promotion requires yearly billing.",
  not_business: "The subscription is not on the Business plan.",
  period_ended: "The paid period has already ended.",
  not_eligible: "The account does not currently qualify.",
};

export async function fetchPrinterEligibility(input: {
  shopId: string;
  promotionCode?: string;
}): Promise<RpcOutcome<EligibilityPreview>> {
  if (!supabase) return { ok: false, error: "Not configured for this build." };

  const { data, error } = await supabase.rpc("internal_ops_printer_eligibility", {
    p_shop_id: input.shopId,
    p_promotion_code: input.promotionCode?.trim() ? input.promotionCode.trim() : DEFAULT_PROMOTION_CODE,
  });
  const envelope = unwrap(data, error);
  if (envelope.ok !== true) {
    return { ok: false, error: String(envelope.error ?? "Eligibility could not be checked.") };
  }
  return { ok: true, data: envelope as unknown as EligibilityPreview };
}

// ---------------------------------------------------------------------------
// CUSTOMER side (20261013140000)
// ---------------------------------------------------------------------------
/**
 * What the MERCHANT may see about their own account.
 *
 * Deliberately not the admin preview. `internal_ops_printer_eligibility` is
 * gated on the fulfilment roles and carries desk-only fields; this is the
 * customer read, gated on `user_can_access_shop()`, and its `eligible` verdict
 * is delegated to the same `_printer_promotion_eligible()` predicate the
 * reservation calls — so the screen cannot promise what the desk would refuse.
 */
export type CustomerPrinterClaim = {
  status: string;
  serial_number: string | null;
  model: string | null;
  reserved_until: string | null;
  handed_over_at: string | null;
};

export type CustomerPrinterRequest = {
  id: string;
  channel: string;
  status: string;
  created_at: string;
  acknowledged_at: string | null;
  fulfilled_at: string | null;
};

export type CustomerPrinterStatus = {
  shop_id: string;
  organization_id: string;
  plan_code: string | null;
  subscription_status: string | null;
  billing_interval: string | null;
  current_period_end: string | null;
  eligible: boolean;
  reason: string | null;
  open_claim: CustomerPrinterClaim | null;
  can_request: boolean;
  requests: CustomerPrinterRequest[];
  reservation_days: number;
};

export async function fetchMyOrgPrinterStatus(input: {
  shopId: string;
}): Promise<RpcOutcome<CustomerPrinterStatus>> {
  if (!supabase) return { ok: false, error: "Not configured for this build." };

  const { data, error } = await supabase.rpc("my_org_printer_status", { p_shop_id: input.shopId });
  const envelope = unwrap(data, error);
  if (envelope.ok !== true) {
    return { ok: false, error: String(envelope.error ?? "Your printer status could not be loaded.") };
  }
  return { ok: true, data: envelope as unknown as CustomerPrinterStatus };
}

/**
 * Ask to collect the promotional printer.
 *
 * A REQUEST, not a reservation: the server records the ask and the fulfilment
 * desk allocates a real unit. Eligibility is re-checked server-side, so this
 * cannot be used to talk past the promotion's rule.
 */
export async function requestPrinterCollection(input: {
  shopId: string;
  channel: "branch" | "whatsapp";
  contactPhone?: string | null;
  note?: string | null;
}): Promise<RpcOutcome<{ requestId: string; alreadyOpen: boolean; status: string }>> {
  if (!supabase) return { ok: false, error: "Not configured for this build." };

  const { data, error } = await supabase.rpc("my_org_printer_request_collection", {
    p_shop_id: input.shopId,
    p_channel: input.channel,
    p_contact_phone: input.contactPhone?.trim() ? input.contactPhone.trim() : null,
    p_note: input.note?.trim() ? input.note.trim() : null,
  });
  const envelope = unwrap(data, error);
  if (envelope.ok !== true) {
    return { ok: false, error: String(envelope.error ?? "Your request could not be recorded.") };
  }
  return {
    ok: true,
    data: {
      requestId: String(envelope.request_id ?? ""),
      alreadyOpen: envelope.already_open === true,
      status: String(envelope.status ?? "requested"),
    },
  };
}

// ---------------------------------------------------------------------------
// FULFILMENT DESK — the collection-request queue
// ---------------------------------------------------------------------------
/**
 * Requests merchants have made, for the desk to work.
 *
 * WHY THIS EXISTS. The customer half shipped first: a merchant could ask for
 * their printer and the request landed in `printer_collection_requests` — with
 * NOTHING able to read it. A request nobody can see is worse than no request at
 * all, so the queue the RPCs already support is surfaced here.
 *
 * These are the ADMIN RPCs (`internal_ops_printer_requests`,
 * `internal_ops_printer_request_set_status`), both gated server-side on
 * `_printer_require_fulfilment_admin()`. Nothing here is reachable from a
 * customer surface.
 */
export type PrinterCollectionRequest = {
  request_id: string;
  organization_id: string;
  organization_name: string | null;
  shop_id: string | null;
  shop_name: string | null;
  shop_number: string | null;
  channel: string;
  status: string;
  contact_phone: string | null;
  note: string | null;
  created_at: string;
  acknowledged_at: string | null;
  fulfilled_at: string | null;
  /** Set once the account holds a printer, so a stale request is visible as one. */
  open_assignment_id: string | null;
};

export async function fetchPrinterRequests(input?: {
  status?: PrinterRequestStatus | null;
  limit?: number;
}): Promise<RpcOutcome<{ requests: PrinterCollectionRequest[] }>> {
  if (!supabase) return { ok: false, error: "Not configured for this build." };

  const { data, error } = await supabase.rpc("internal_ops_printer_requests", {
    p_status: input?.status ?? null,
    p_limit: Math.min(Math.max(input?.limit ?? 100, 1), 500),
  });
  const envelope = unwrap(data, error);
  if (envelope.ok !== true) {
    return { ok: false, error: String(envelope.error ?? "The request queue could not be loaded.") };
  }
  const rows = Array.isArray(envelope.requests) ? (envelope.requests as PrinterCollectionRequest[]) : [];
  return { ok: true, data: { requests: rows } };
}

export const PRINTER_REQUEST_STATUSES = ["requested", "acknowledged", "fulfilled", "cancelled"] as const;
export type PrinterRequestStatus = (typeof PRINTER_REQUEST_STATUSES)[number];

export const PRINTER_REQUEST_STATUS_LABELS: Record<string, string> = {
  requested: "Requested",
  acknowledged: "Being arranged",
  fulfilled: "Completed",
  cancelled: "Cancelled",
};

/**
 * Move a request along.
 *
 * Marks the REQUEST only. Allocating a unit — the step that actually gives the
 * merchant a printer — remains `internal_ops_printer_assign`, so this cannot
 * become a second path to stock.
 */
export async function setPrinterRequestStatus(input: {
  requestId: string;
  status: PrinterRequestStatus;
}): Promise<RpcOutcome<{ status: string }>> {
  if (!supabase) return { ok: false, error: "Not configured for this build." };

  const { data, error } = await supabase.rpc("internal_ops_printer_request_set_status", {
    p_request_id: input.requestId,
    p_status: input.status,
  });
  const envelope = unwrap(data, error);
  if (envelope.ok !== true) {
    return { ok: false, error: String(envelope.error ?? "The request could not be updated.") };
  }
  return { ok: true, data: { status: String(envelope.status ?? input.status) } };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** `WP58-2609-001` → `2609`. Mirrors `_printer_batch_code_from_serial`. */
export function batchCodeFromSerial(serial: string): string | null {
  const m = /^WP58-([0-9]{4})-[0-9]{3}$/.exec(serial.toUpperCase().trim());
  return m ? m[1]! : null;
}

/**
 * Client-side shape check, mirroring the table CHECK. It exists so the operator
 * gets feedback before a round trip — the server and the database remain the
 * authority, and both reject anything this lets through.
 */
export function serialShapeError(serial: string): string | null {
  const s = serial.trim().toUpperCase();
  if (!s) return "Enter the serial printed on the label.";
  if (!/^[A-Z0-9][A-Z0-9-]{2,31}$/.test(s)) {
    return "Uppercase letters, digits and hyphens only — for example WP58-2609-001.";
  }
  return null;
}

/** Whole days until a lease lapses; negative once it has. */
export function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return Math.ceil((then - Date.now()) / 86_400_000);
}
