import { supabase } from "./supabase";

/** Structured evidence for why the corrected values are the true historical cost. */
export type CorrectionBasis =
  | {
      basisType: "pack_cost_conversion";
      packCostUgx: number;
      conversionRate: number;
      sourceReferenceIds?: string[];
    }
  | {
      basisType: "purchase_record" | "audit_log_cost_change" | "other";
      sourceReferenceIds: string[];
      note?: string;
    };

export type CorrectionFinancialValues = {
  unitCostUgx: number;
  cogsUgx: number;
  grossProfitUgx: number;
  estimatedProfitUgx: number;
};

export type CorrectSaleLineFinancialsInput = {
  shopId: string;
  saleId: string;
  saleLineItemId: string;
  expectedCurrentRevision: number;
  expectedBefore: CorrectionFinancialValues;
  correctionBasis: CorrectionBasis;
  reason: string;
};

export type CorrectSaleLineFinancialsResult =
  | {
      ok: true;
      correctionId: string;
      resultingLineRevision: number;
      resultingSaleRevision: number;
      closedDayRequiresRegeneration: boolean;
      affectedDateKey: string;
    }
  | { ok: false; error: string; detail?: unknown };

/**
 * The exclusive client-side entry point to public.shop_correct_sale_line_financials.
 * No other code path in this app may write sale_line_item_corrections or a completed
 * sale's cogsUgx/unitCostUgx/grossProfitUgx/estimatedProfitUgx. The server derives the
 * corrected values itself from correctionBasis + live provenance — the client never
 * submits a "corrected" value; expectedBefore is CAS-only, and the server always
 * re-derives its own "before" from the current row regardless of what's sent here.
 */
export async function correctSaleLineFinancials(
  input: CorrectSaleLineFinancialsInput,
): Promise<CorrectSaleLineFinancialsResult> {
  if (!supabase) return { ok: false, error: "offline" };

  const { data, error } = await supabase.rpc("shop_correct_sale_line_financials", {
    p_shop_id: input.shopId,
    p_sale_id: input.saleId,
    p_sale_line_item_id: input.saleLineItemId,
    p_expected_current_revision: input.expectedCurrentRevision,
    p_expected_before: input.expectedBefore,
    p_correction_basis: input.correctionBasis,
    p_reason: input.reason,
  });

  if (error) return { ok: false, error: error.message };

  const row = data as
    | {
        ok?: boolean;
        error?: string;
        correction_id?: string;
        resulting_line_revision?: number;
        resulting_sale_revision?: number;
        closed_day_requires_regeneration?: boolean;
        affected_date_key?: string;
        [key: string]: unknown;
      }
    | null;

  if (!row || row.ok !== true) {
    const { ok: _ok, error: errCode, ...rest } = row ?? {};
    return { ok: false, error: errCode ?? "correction_failed", detail: rest };
  }

  return {
    ok: true,
    correctionId: String(row.correction_id ?? ""),
    resultingLineRevision: row.resulting_line_revision ?? 0,
    resultingSaleRevision: row.resulting_sale_revision ?? 0,
    closedDayRequiresRegeneration: row.closed_day_requires_regeneration === true,
    affectedDateKey: String(row.affected_date_key ?? ""),
  };
}

export type RegenerateDayCloseResult =
  | { ok: true; noActiveClose: true }
  | { ok: true; alreadyReflected: true; activeCloseId: string; profitEstimateUgx: number }
  | { ok: true; supersededCloseId: string; newCloseId: string; profitEstimateUgx: number }
  | { ok: false; error: string; reason?: string };

/** The exclusive client-side entry point to public.admin_regenerate_day_close_for_correction. */
export async function regenerateDayCloseForCorrection(
  shopId: string,
  dateKey: string,
): Promise<RegenerateDayCloseResult> {
  if (!supabase) return { ok: false, error: "offline" };

  const { data, error } = await supabase.rpc("admin_regenerate_day_close_for_correction", {
    p_shop_id: shopId,
    p_date_key: dateKey,
  });

  if (error) return { ok: false, error: error.message };

  const row = data as
    | {
        ok?: boolean;
        error?: string;
        reason?: string;
        no_active_close?: boolean;
        already_reflected?: boolean;
        active_close_id?: string;
        superseded_close_id?: string;
        new_close_id?: string;
        profit_estimate_ugx?: number;
      }
    | null;

  if (!row || row.ok !== true) {
    return { ok: false, error: row?.error ?? "regeneration_failed", reason: row?.reason };
  }
  if (row.no_active_close) return { ok: true, noActiveClose: true };
  if (row.already_reflected) {
    return {
      ok: true,
      alreadyReflected: true,
      activeCloseId: String(row.active_close_id ?? ""),
      profitEstimateUgx: row.profit_estimate_ugx ?? 0,
    };
  }
  return {
    ok: true,
    supersededCloseId: String(row.superseded_close_id ?? ""),
    newCloseId: String(row.new_close_id ?? ""),
    profitEstimateUgx: row.profit_estimate_ugx ?? 0,
  };
}

export type FinancialFingerprint = {
  shopId: string;
  lineCount: number;
  maxLineRevision: number;
  revisionSum: number;
  digest: string;
};

/** The exclusive client-side entry point to public.shop_get_financial_fingerprint. */
export async function fetchShopFinancialFingerprint(
  shopId: string,
): Promise<{ ok: true; fingerprint: FinancialFingerprint } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: "offline" };

  const { data, error } = await supabase.rpc("shop_get_financial_fingerprint", { p_shop_id: shopId });
  if (error) return { ok: false, error: error.message };

  const row = data as
    | { ok?: boolean; error?: string; shop_id?: string; line_count?: number; max_line_revision?: number; revision_sum?: number; digest?: string }
    | null;

  if (!row || row.ok !== true) return { ok: false, error: row?.error ?? "fingerprint_failed" };

  return {
    ok: true,
    fingerprint: {
      shopId: String(row.shop_id ?? shopId),
      lineCount: row.line_count ?? 0,
      maxLineRevision: row.max_line_revision ?? 0,
      revisionSum: row.revision_sum ?? 0,
      digest: row.digest ?? "",
    },
  };
}

export type SaleLineLookupResult =
  | {
      found: true;
      shopId: string;
      saleId: string;
      saleLineItemId: string;
      productId: string;
      productName: string;
      quantity: number;
      lineTotalUgx: number;
      financialRevision: number;
      current: CorrectionFinancialValues;
      conversionRate: number | null;
    }
  | { found: false; error: string };

/**
 * Read-only lookup of a specific sale line's current server-stored financial snapshot,
 * for populating the correction dialog's "before" state. Relies entirely on RLS
 * (sale_lines_select / sales_select) — an internal admin without
 * internal_can_view_sensitive_shop_data() will get zero rows back, not an error.
 */
export async function lookupSaleLineForCorrection(
  shopId: string,
  saleLineItemId: string,
): Promise<SaleLineLookupResult> {
  if (!supabase) return { found: false, error: "offline" };

  const { data, error } = await supabase
    .from("sale_line_items")
    .select(
      "id, sale_id, product_id, quantity, line_total_ugx, financial_revision, metadata, sales!inner(shop_id, status), products(name, conversion_rate)",
    )
    .eq("id", saleLineItemId)
    .eq("sales.shop_id", shopId)
    .maybeSingle();

  if (error) return { found: false, error: error.message };
  if (!data) return { found: false, error: "not_found_or_no_access" };

  const meta = (data.metadata ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
  const unitCostUgx = num(meta.unitCostUgx);
  const cogsUgx = num(meta.cogsUgx);
  const grossProfitUgx = num(meta.grossProfitUgx);
  const estimatedProfitUgx = num(meta.estimatedProfitUgx);

  if (unitCostUgx === null || cogsUgx === null || grossProfitUgx === null || estimatedProfitUgx === null) {
    return { found: false, error: "malformed_or_missing_financial_snapshot" };
  }

  const sale = Array.isArray(data.sales) ? data.sales[0] : data.sales;
  const product = Array.isArray(data.products) ? data.products[0] : data.products;

  if (sale?.status !== "completed") {
    return { found: false, error: "sale_not_completed" };
  }

  return {
    found: true,
    shopId,
    saleId: data.sale_id,
    saleLineItemId: data.id,
    productId: data.product_id,
    productName: product?.name ?? "",
    quantity: Number(data.quantity),
    lineTotalUgx: Number(data.line_total_ugx),
    financialRevision: Number(data.financial_revision ?? 0),
    current: { unitCostUgx, cogsUgx, grossProfitUgx, estimatedProfitUgx },
    conversionRate: product?.conversion_rate != null ? Number(product.conversion_rate) : null,
  };
}
