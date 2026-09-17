import { supabase } from "./supabase";

/**
 * Shop-user-facing report entry point (public.shop_report_financial_issue). Never
 * accepts sale_id/product_id from the caller — the server re-derives both from
 * sale_line_item_id, so this function's own inputs are the only UUID a shop user's
 * client ever needs to know: shopId (already known from context) and
 * saleLineItemId (already known from the sale/receipt the user is viewing — never
 * typed in by the user).
 */
export async function reportFinancialIssue(input: {
  shopId: string;
  saleLineItemId: string;
  reason: string;
  evidenceNote?: string;
}): Promise<{ ok: true; requestId: string } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: "offline" };

  const { data, error } = await supabase.rpc("shop_report_financial_issue", {
    p_shop_id: input.shopId,
    p_sale_line_item_id: input.saleLineItemId,
    p_reason: input.reason,
    p_evidence_note: input.evidenceNote ?? null,
  });

  if (error) return { ok: false, error: error.message };

  const row = data as { ok?: boolean; error?: string; request_id?: string } | null;
  if (!row || row.ok !== true) return { ok: false, error: row?.error ?? "report_failed" };
  return { ok: true, requestId: String(row.request_id ?? "") };
}

export type FinancialCorrectionRequestStatus =
  | "submitted"
  | "under_review"
  | "approved"
  | "rejected"
  | "correction_applied"
  | "requires_manual_review";

export type FinancialCorrectionRequestRow = {
  id: string;
  shopId: string;
  shopName: string;
  saleId: string;
  saleLineItemId: string;
  productId: string;
  productName: string;
  quantity: number;
  saleDate: string;
  saleStatus: string;
  currentUnitCostUgx: number | null;
  currentCogsUgx: number | null;
  currentGrossProfitUgx: number | null;
  financialRevision: number;
  reason: string;
  evidenceNote: string | null;
  status: FinancialCorrectionRequestStatus;
  adminNotes: string | null;
  reportedByUserId: string;
  correctionId: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Internal-admin queue read (public.internal_list_financial_correction_requests). */
export async function listFinancialCorrectionRequests(
  status?: FinancialCorrectionRequestStatus,
): Promise<{ ok: true; requests: FinancialCorrectionRequestRow[] } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: "offline" };

  const { data, error } = await supabase.rpc("internal_list_financial_correction_requests", {
    p_status: status ?? null,
  });

  if (error) return { ok: false, error: error.message };

  const row = data as { ok?: boolean; error?: string; requests?: unknown } | null;
  if (!row || row.ok !== true) return { ok: false, error: row?.error ?? "list_failed" };

  const raw = Array.isArray(row.requests) ? row.requests : [];
  const requests: FinancialCorrectionRequestRow[] = raw.map((r) => {
    const x = r as Record<string, unknown>;
    const num = (v: unknown): number | null =>
      typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null;
    return {
      id: String(x.id ?? ""),
      shopId: String(x.shopId ?? ""),
      shopName: String(x.shopName ?? ""),
      saleId: String(x.saleId ?? ""),
      saleLineItemId: String(x.saleLineItemId ?? ""),
      productId: String(x.productId ?? ""),
      productName: String(x.productName ?? ""),
      quantity: num(x.quantity) ?? 0,
      saleDate: String(x.saleDate ?? ""),
      saleStatus: String(x.saleStatus ?? ""),
      currentUnitCostUgx: num(x.currentUnitCostUgx),
      currentCogsUgx: num(x.currentCogsUgx),
      currentGrossProfitUgx: num(x.currentGrossProfitUgx),
      financialRevision: num(x.financialRevision) ?? 0,
      reason: String(x.reason ?? ""),
      evidenceNote: x.evidenceNote != null ? String(x.evidenceNote) : null,
      status: (x.status as FinancialCorrectionRequestStatus) ?? "submitted",
      adminNotes: x.adminNotes != null ? String(x.adminNotes) : null,
      reportedByUserId: String(x.reportedByUserId ?? ""),
      correctionId: x.correctionId != null ? String(x.correctionId) : null,
      resolvedBy: x.resolvedBy != null ? String(x.resolvedBy) : null,
      resolvedAt: x.resolvedAt != null ? String(x.resolvedAt) : null,
      createdAt: String(x.createdAt ?? ""),
      updatedAt: String(x.updatedAt ?? ""),
    };
  });

  return { ok: true, requests };
}

/** Internal-admin investigation step. Can never reach 'correction_applied' — see migration 195. */
export async function setFinancialCorrectionRequestStatus(
  requestId: string,
  status: "under_review" | "approved" | "rejected" | "requires_manual_review",
  adminNotes?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: "offline" };

  const { data, error } = await supabase.rpc("internal_set_financial_correction_request_status", {
    p_request_id: requestId,
    p_status: status,
    p_admin_notes: adminNotes ?? null,
  });

  if (error) return { ok: false, error: error.message };
  const row = data as { ok?: boolean; error?: string } | null;
  if (!row || row.ok !== true) return { ok: false, error: row?.error ?? "update_failed" };
  return { ok: true };
}

/**
 * The only call that can move a request to 'correction_applied' — invoked by the admin
 * UI immediately after a successful, separate call to shop_correct_sale_line_financials.
 * super_admin/finance_admin only (same gate as the correction RPC itself).
 */
export async function linkFinancialCorrectionRequest(
  requestId: string,
  correctionId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: "offline" };

  const { data, error } = await supabase.rpc("internal_link_financial_correction_request", {
    p_request_id: requestId,
    p_correction_id: correctionId,
  });

  if (error) return { ok: false, error: error.message };
  const row = data as { ok?: boolean; error?: string } | null;
  if (!row || row.ok !== true) return { ok: false, error: row?.error ?? "link_failed" };
  return { ok: true };
}
