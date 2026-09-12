/**
 * Ask WAKA tool allowlist + argument validation (client mirror for tests).
 * Edge runtime copy: supabase/functions/_shared/askWakaTools.ts
 *
 * Security: no SQL, no shop_id from the model, no write tools.
 */

import { calendarWeekToolArgs, kampalaToday } from "./askWakaPeriods";

export const ASK_WAKA_TOOL_NAMES = [
  "get_today_sales",
  "get_sales_for_period",
  "get_week_comparison",
  "get_top_products",
  "get_slow_products",
  "get_inventory_summary",
  "get_low_stock_products",
  "get_expense_summary",
  "get_customer_summary",
  "get_staff_sales_summary",
  "get_shift_report",
  "get_payment_method_summary",
  "get_notable_sales",
  "get_unsold_products",
  "get_credit_sales",
  "get_shift_sales",
  "get_inventory_movements",
] as const;

export type AskWakaToolName = (typeof ASK_WAKA_TOOL_NAMES)[number];

/** Explicit: no write / mutation tools exist in ASK-1. */
export const ASK_WAKA_WRITE_TOOLS: readonly string[] = [];

export const ASK_WAKA_MAX_MESSAGE_CHARS = 2000;
export const ASK_WAKA_MAX_LIMIT = 20;
export const ASK_WAKA_MAX_DATE_SPAN_DAYS = 92;
export const ASK_WAKA_MAX_TOOL_ROUNDS = 3;
export const ASK_WAKA_MAX_TOOLS_PER_ROUND = 4;
/** ASK-4A: hard ceiling on distinct tool EXECUTIONS per request, independent of round/per-round shape. Cache hits (see toolCacheKey) never count against this. */
export const ASK_WAKA_MAX_TOTAL_TOOL_CALLS = 6;
/** ASK-4A: whole-orchestration wall-clock budget (LLM calls + tool execution + retries), not a single HTTP timeout. */
export const ASK_WAKA_MAX_ORCHESTRATION_MS = 45_000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isAskWakaToolName(value: string): value is AskWakaToolName {
  return (ASK_WAKA_TOOL_NAMES as readonly string[]).includes(value);
}

export function isAskWakaWriteTool(name: string): boolean {
  return ASK_WAKA_WRITE_TOOLS.includes(name);
}

export type AskWakaArgError = { ok: false; code: string; reason: string };
export type AskWakaArgOk = { ok: true; args: Record<string, unknown> };
export type AskWakaArgResult = AskWakaArgOk | AskWakaArgError;

function reject(code: string, reason: string): AskWakaArgError {
  return { ok: false, code, reason };
}

function parseDay(raw: unknown, field: string): string | AskWakaArgError | null {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string" || !DATE_RE.test(raw)) {
    return reject("invalid_args", `Invalid ${field}; expected YYYY-MM-DD`);
  }
  return raw;
}

function parseLimit(raw: unknown, fallback: number): number | AskWakaArgError {
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return reject("invalid_args", "Invalid limit");
  return Math.min(ASK_WAKA_MAX_LIMIT, Math.floor(n));
}

/**
 * Resolve a day="today" or week=this|last argument to a start/end range.
 * "today" always wins — a shift is never confused with either, and this
 * never substitutes for one.
 */
function dayOrWeekArgs(args: Record<string, unknown>): {
  start_day: string;
  end_day: string;
  scope: "day" | "week";
  week: "this" | "last" | null;
  period_label: string;
  in_progress: boolean;
} {
  if (args.day === "today") {
    const today = kampalaToday();
    return { start_day: today, end_day: today, scope: "day", week: null, period_label: "Today", in_progress: true };
  }
  const weekRaw = String(args.week ?? "this").toLowerCase() === "last" ? "last" : "this";
  const week = calendarWeekToolArgs(weekRaw);
  return {
    start_day: week.start_day,
    end_day: week.end_day,
    scope: "week",
    week: week.week === "last" ? "last" : "this",
    period_label: week.period_label,
    in_progress: week.in_progress,
  };
}

function assertNoShopId(args: Record<string, unknown>): AskWakaArgError | null {
  if ("shop_id" in args || "shopId" in args || "p_shop_id" in args) {
    return reject("shop_id_forbidden", "Tools must not select shop_id; server binds shop scope");
  }
  return null;
}

function assertNoSql(args: Record<string, unknown>): AskWakaArgError | null {
  for (const [k, v] of Object.entries(args)) {
    const key = k.toLowerCase();
    if (key.includes("sql") || key === "query" || key === "statement") {
      return reject("sql_forbidden", "Arbitrary SQL/query arguments are not allowed");
    }
    if (typeof v === "string") {
      const lower = v.toLowerCase();
      if (
        /\b(select|insert|update|delete|drop|alter|truncate|grant|revoke)\b/.test(lower) &&
        (lower.includes(" from ") || lower.includes(" into ") || lower.includes(" table"))
      ) {
        return reject("sql_forbidden", "Arbitrary SQL is not allowed");
      }
    }
  }
  return null;
}

/**
 * Validate and sanitize tool arguments. Rejects unknown tools, shop_id, SQL, and bad limits.
 * Shop scope is never taken from args — caller must bind authenticated shop separately.
 */
export function validateAskWakaToolCall(
  toolName: string,
  rawArgs: unknown,
): AskWakaArgResult {
  if (!isAskWakaToolName(toolName)) {
    return reject("unknown_tool", `Unknown tool: ${toolName}`);
  }
  if (isAskWakaWriteTool(toolName)) {
    return reject("write_forbidden", "Write tools are not available");
  }

  const args =
    rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
      ? (rawArgs as Record<string, unknown>)
      : {};

  const shopErr = assertNoShopId(args);
  if (shopErr) return shopErr;
  const sqlErr = assertNoSql(args);
  if (sqlErr) return sqlErr;

  switch (toolName) {
    case "get_today_sales": {
      const day = parseDay(args.day, "day");
      if (day && typeof day === "object" && "ok" in day && day.ok === false) return day;
      return { ok: true, args: day ? { day } : {} };
    }
    case "get_week_comparison":
      return { ok: true, args: {} };
    case "get_sales_for_period": {
      const period = String(args.period ?? "week").toLowerCase();
      if (period !== "week" && period !== "month") {
        return reject("invalid_args", "period must be week or month");
      }
      if (period === "week") {
        const weekRaw = String(args.week ?? "this").toLowerCase();
        if (weekRaw !== "this" && weekRaw !== "last") {
          return reject("invalid_args", "week must be this or last");
        }
        // Server resolves calendar weeks. Model-supplied dates are ignored.
        return { ok: true, args: { period, ...calendarWeekToolArgs(weekRaw) } };
      }
      const monthRaw = args.month;
      if (monthRaw != null && monthRaw !== "") {
        if (typeof monthRaw !== "string" || !MONTH_RE.test(monthRaw)) {
          return reject("invalid_args", "month must be YYYY-MM");
        }
        return { ok: true, args: { period, month: monthRaw } };
      }
      return { ok: true, args: { period } };
    }
    case "get_top_products":
    case "get_slow_products": {
      if (args.day != null && args.day !== "today") {
        return reject("invalid_args", "day must be 'today'");
      }
      if (args.week != null) {
        const weekRaw = String(args.week).toLowerCase();
        if (weekRaw !== "this" && weekRaw !== "last") {
          return reject("invalid_args", "week must be this or last");
        }
      }
      const limit = parseLimit(args.limit, 10);
      if (typeof limit === "object") return limit;
      return { ok: true, args: { ...dayOrWeekArgs(args), limit } };
    }
    case "get_inventory_summary":
    case "get_expense_summary":
      return { ok: true, args: {} };
    case "get_low_stock_products": {
      const limit = parseLimit(args.limit, 15);
      if (typeof limit === "object") return limit;
      return { ok: true, args: { limit } };
    }
    case "get_customer_summary":
    case "get_staff_sales_summary": {
      const weekRaw = String(args.week ?? "this").toLowerCase();
      if (weekRaw !== "this" && weekRaw !== "last") {
        return reject("invalid_args", "week must be this or last");
      }
      const limit = parseLimit(args.limit, toolName === "get_staff_sales_summary" ? 20 : 10);
      if (typeof limit === "object") return limit;
      return { ok: true, args: { ...calendarWeekToolArgs(weekRaw), limit } };
    }
    case "get_shift_report":
    case "get_shift_sales": {
      const shiftIdRaw = args.shift_id;
      if (shiftIdRaw == null || shiftIdRaw === "") {
        return { ok: true, args: {} };
      }
      if (typeof shiftIdRaw !== "string" || !UUID_RE.test(shiftIdRaw)) {
        return reject("invalid_args", "shift_id must be a valid UUID");
      }
      return { ok: true, args: { shift_id: shiftIdRaw } };
    }
    case "get_payment_method_summary": {
      if (args.day != null && args.day !== "today") {
        return reject("invalid_args", "day must be 'today'");
      }
      if (args.week != null) {
        const weekRaw = String(args.week).toLowerCase();
        if (weekRaw !== "this" && weekRaw !== "last") {
          return reject("invalid_args", "week must be this or last");
        }
      }
      return { ok: true, args: dayOrWeekArgs(args) };
    }
    case "get_notable_sales": {
      if (args.day != null && args.day !== "today") {
        return reject("invalid_args", "day must be 'today'");
      }
      if (args.week != null) {
        const weekRaw = String(args.week).toLowerCase();
        if (weekRaw !== "this" && weekRaw !== "last") {
          return reject("invalid_args", "week must be this or last");
        }
      }
      const limit = parseLimit(args.limit, 5);
      if (typeof limit === "object") return limit;
      return { ok: true, args: { ...dayOrWeekArgs(args), limit } };
    }
    case "get_unsold_products": {
      const weekRaw = String(args.week ?? "this").toLowerCase();
      if (weekRaw !== "this" && weekRaw !== "last") {
        return reject("invalid_args", "week must be this or last");
      }
      const limit = parseLimit(args.limit, 50);
      if (typeof limit === "object") return limit;
      return { ok: true, args: { ...calendarWeekToolArgs(weekRaw), limit } };
    }
    case "get_credit_sales": {
      const day = parseDay(args.day, "day");
      if (day && typeof day === "object" && "ok" in day && day.ok === false) return day;
      return { ok: true, args: day ? { day } : {} };
    }
    case "get_inventory_movements": {
      if (args.day != null && args.day !== "today") {
        return reject("invalid_args", "day must be 'today'");
      }
      if (args.week != null) {
        const weekRaw = String(args.week).toLowerCase();
        if (weekRaw !== "this" && weekRaw !== "last") {
          return reject("invalid_args", "week must be this or last");
        }
      }
      const reasonRaw = args.reason;
      if (
        reasonRaw != null &&
        !["sale", "return", "adjustment", "initial", "transfer", "waste", "other"].includes(String(reasonRaw))
      ) {
        return reject("invalid_args", "invalid reason");
      }
      return { ok: true, args: { ...dayOrWeekArgs(args), reason: reasonRaw ?? null } };
    }
    default:
      return reject("unknown_tool", `Unknown tool: ${toolName}`);
  }
}

/**
 * Resolve shop context for Ask WAKA.
 * preferredShopId is a hint only; must be independently verified as accessible.
 * Reporting RPCs use the user's primary shop — preferred must match primary when provided.
 */
export function resolveAskWakaShopScope(input: {
  preferredShopId?: string | null;
  primaryShopId: string | null;
  accessibleShopIds: readonly string[];
}): { ok: true; shopId: string } | { ok: false; code: string; reason: string } {
  const primary = input.primaryShopId?.trim() || null;
  if (!primary) {
    return { ok: false, code: "no_shop", reason: "No shop available for this user" };
  }
  if (!input.accessibleShopIds.includes(primary)) {
    return { ok: false, code: "forbidden", reason: "Shop access denied" };
  }

  const preferred = input.preferredShopId?.trim() || null;
  if (!preferred) {
    return { ok: true, shopId: primary };
  }
  if (!UUID_RE.test(preferred)) {
    return { ok: false, code: "invalid_shop_id", reason: "Invalid shop_id" };
  }
  if (!input.accessibleShopIds.includes(preferred)) {
    return { ok: false, code: "forbidden", reason: "Shop access denied" };
  }
  if (preferred !== primary) {
    return {
      ok: false,
      code: "shop_context_mismatch",
      reason: "Ask WAKA reporting uses your primary shop context in this version",
    };
  }
  return { ok: true, shopId: primary };
}

export function validateAskWakaMessage(message: unknown): { ok: true; message: string } | AskWakaArgError {
  if (typeof message !== "string") {
    return reject("invalid_body", "message is required");
  }
  const trimmed = message.trim();
  if (!trimmed) return reject("invalid_body", "message is required");
  if (trimmed.length > ASK_WAKA_MAX_MESSAGE_CHARS) {
    return reject("message_too_long", `message exceeds ${ASK_WAKA_MAX_MESSAGE_CHARS} characters`);
  }
  return { ok: true, message: trimmed };
}

/** Cap product/customer list payloads before they reach the model. */
/** Deterministic key regardless of object-key order, so repeated identical calls always collide. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/**
 * Request-local dedup key for a tool call (ASK-4A). Two calls with the same
 * tool name and semantically-equal arguments (any key order) collide, so the
 * model asking for "today's sales" twice reuses the first result instead of
 * executing it again. Never persisted — lives only for one request's Map.
 */
export function toolCacheKey(toolName: string, args: unknown): string {
  return `${toolName}::${stableStringify(args ?? {})}`;
}

/**
 * ASK-4A tool-call runner: request-local dedup cache + hard total-call budget,
 * decoupled from actual execution (injected as `execute`) so this decision
 * logic is unit-testable without a real Supabase client. The edge runtime
 * (askWakaTools.ts) constructs one of these per request with `executeAskWakaTool`
 * as `execute`; nothing here is persisted or shared across requests.
 */
export function createAskWakaToolRunner<TResult extends { ok: boolean }>(params: {
  execute: (toolName: string, rawArgs: unknown) => Promise<TResult>;
  maxTotalCalls?: number;
  budgetExhaustedResult: (toolName: string) => TResult;
}) {
  const cache = new Map<string, TResult>();
  const maxTotalCalls = params.maxTotalCalls ?? ASK_WAKA_MAX_TOTAL_TOOL_CALLS;
  let totalCalls = 0;
  let budgetExhausted = false;

  async function run(toolName: string, rawArgs: unknown): Promise<TResult> {
    const key = toolCacheKey(toolName, rawArgs);
    const cached = cache.get(key);
    if (cached) return cached;
    if (totalCalls >= maxTotalCalls) {
      budgetExhausted = true;
      return params.budgetExhaustedResult(toolName);
    }
    const result = await params.execute(toolName, rawArgs);
    totalCalls += 1;
    cache.set(key, result);
    return result;
  }

  return {
    run,
    isBudgetExhausted: () => budgetExhausted,
    get totalCalls() {
      return totalCalls;
    },
    get cacheSize() {
      return cache.size;
    },
  };
}

export function limitAskWakaRows<T>(rows: T[], limit = ASK_WAKA_MAX_LIMIT): T[] {
  const n = Math.max(0, Math.min(ASK_WAKA_MAX_LIMIT, Math.floor(limit)));
  return rows.slice(0, n);
}

export function stripCustomerPiiForAskWaka(row: Record<string, unknown>): Record<string, unknown> {
  // Minimize PII: no phone/email/customer_id — display name + aggregates only.
  return {
    name: row.name ?? "Customer",
    purchase_count: row.purchase_count ?? 0,
    lifetime_revenue_ugx: row.lifetime_revenue_ugx ?? 0,
    debt_balance_ugx: row.debt_balance_ugx ?? 0,
  };
}

/**
 * Shape shop_get_shift_report's raw RPC row for the model.
 * Mirrors supabase/functions/_shared/askWakaTools.ts (edge runtime copy) —
 * duplicated here only for unit testability, per this file's existing pattern.
 * All financial fields pass through as-is from the RPC — no recomputation.
 * Non-"ok" statuses carry zero financial data by construction, so the model
 * has nothing to invent from; each carries a `note` steering the model away
 * from ever substituting today's sales for a missing/ambiguous shift.
 */
export function shapeShiftReportForModel(
  row: Record<string, unknown>,
  boundShopId: string,
): Record<string, unknown> {
  if (row.error === "shift_not_found") {
    return {
      status: "shift_not_found",
      note: "The requested shift was not found for this shop. Do not report today's sales instead — tell the user this shift could not be found.",
      shop_id: boundShopId,
    };
  }
  if (row.error === "no_shift_found") {
    return {
      status: "no_shift_found",
      note: "No open or recently closed shift exists for this shop. Do not substitute today's sales — tell the user no shift was found.",
      shop_id: boundShopId,
    };
  }
  if (row.error === "multiple_open_shifts") {
    return {
      status: "multiple_open_shifts",
      candidates: Array.isArray(row.candidates) ? row.candidates : [],
      note: "More than one staff member currently has an open shift. Ask the user which cashier/shift they mean instead of guessing or reporting today's sales.",
      shop_id: boundShopId,
    };
  }
  return {
    status: "ok",
    shift_id: row.shift_id,
    actor_user_id: row.actor_user_id,
    actor_name: row.actor_name ?? null,
    start_at: row.start_at,
    end_at: row.end_at ?? null,
    shift_status: row.status,
    sales_total_ugx: row.sales_total_ugx,
    discounts_ugx: row.discounts_ugx,
    returns_ugx: row.returns_ugx,
    voids_ugx: row.voids_ugx,
    net_sales_ugx: row.net_sales_ugx,
    debt_issued_ugx: row.debt_issued_ugx,
    debt_payments_collected_ugx: row.debt_payments_collected_ugx,
    cash_collected_ugx: row.cash_collected_ugx,
    opening_cash_ugx: row.opening_cash_ugx ?? null,
    counted_cash_ugx: row.counted_cash_ugx ?? null,
    expected_cash_ugx: row.expected_cash_ugx ?? null,
    cash_difference_ugx: row.cash_difference_ugx ?? null,
    verification_status: row.verification_status ?? null,
    cash_reconciliation_available: row.status === "closed" && row.counted_cash_ugx != null,
    payment_methods_note:
      "Only Cash and Debt/Credit are tracked per shift in WAKA POS. Mobile Money/Card/Voucher breakdowns are not available at shift level — do not invent them.",
    expenses_note:
      "Shift-level expenses are not tracked in WAKA POS (expenses are recorded by date, not by shift) — do not state an expense total for this shift.",
    inventory_note:
      "Inventory is not tied to this shift. Use get_inventory_summary separately if asked, and label it as a current shop-wide snapshot, not sales during this shift.",
    shop_id: boundShopId,
  };
}

function minifyProducts(products: unknown, limit: number): Record<string, unknown>[] {
  if (!Array.isArray(products)) return [];
  return limitAskWakaRows(products as Record<string, unknown>[], limit).map((p) => ({
    name: p.name ?? "Item",
    quantity: p.quantity ?? p.qty ?? 0,
    revenue_ugx: p.revenue_ugx ?? 0,
    profit_ugx: p.profit_ugx ?? null,
  }));
}

/** Shape shop_get_top_products/shop_get_unsold_products for day or week scope. */
export function shapeProductsForModel(
  row: Record<string, unknown>,
  args: Record<string, unknown>,
  limit: number,
): Record<string, unknown> {
  const products = minifyProducts(row.products, limit);
  return {
    scope: args.scope ?? "week",
    week: args.week ?? null,
    start_day: args.start_day ?? row.start_day,
    end_day: args.end_day ?? row.end_day,
    period_label: args.period_label ?? null,
    in_progress: args.in_progress === true,
    order: row.order ?? null,
    products,
    empty_confirmed: products.length === 0,
  };
}

function minifyPaymentMethods(methods: unknown): Record<string, unknown>[] {
  if (!Array.isArray(methods)) return [];
  return (methods as Record<string, unknown>[]).map((m) => ({
    method: m.method,
    amount_ugx: m.amount_ugx ?? 0,
  }));
}

/** Shape shop_get_payment_method_summary's raw RPC row for the model. */
export function shapePaymentMethodSummaryForModel(
  row: Record<string, unknown>,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const methods = minifyPaymentMethods(row.methods);
  return {
    scope: args.scope ?? "week",
    week: args.week ?? null,
    start_day: args.start_day ?? row.start_day,
    end_day: args.end_day ?? row.end_day,
    period_label: args.period_label ?? null,
    methods,
    total_ugx: row.total_ugx ?? 0,
    empty_confirmed: methods.length === 0,
    note: "Only payment methods with a recorded payment appear here. Debt/credit sales are reported separately (see get_credit_sales / get_customer_summary), not as a payment method.",
  };
}

/** Shape shop_get_notable_sales's raw RPC row for the model. No customer identity, by design. */
export function shapeNotableSalesForModel(
  row: Record<string, unknown>,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const salesRaw = Array.isArray(row.sales) ? (row.sales as Record<string, unknown>[]) : [];
  const sales = salesRaw.map((s) => ({
    sale_id: s.sale_id,
    completed_at: s.completed_at,
    total_ugx: s.total_ugx,
    item_count: s.item_count,
    payment_methods: minifyPaymentMethods(s.payment_methods),
  }));
  return {
    scope: args.scope ?? "week",
    week: args.week ?? null,
    start_day: args.start_day ?? row.start_day,
    end_day: args.end_day ?? row.end_day,
    period_label: args.period_label ?? null,
    sales,
    empty_confirmed: sales.length === 0,
  };
}

/** Shape shop_get_credit_sales's raw RPC row for the model. Never confuse with cumulative outstanding debt. */
export function shapeCreditSalesForModel(row: Record<string, unknown>): Record<string, unknown> {
  const rowsRaw = Array.isArray(row.credit_sales) ? (row.credit_sales as Record<string, unknown>[]) : [];
  const creditSales = rowsRaw.map((c) => ({
    customer_name: c.customer_name ?? "Customer",
    sale_total_ugx: c.sale_total_ugx,
    debt_amount_ugx: c.debt_amount_ugx,
    completed_at: c.completed_at,
  }));
  return {
    day: row.day,
    credit_sales: creditSales,
    total_debt_created_ugx: row.total_debt_created_ugx ?? 0,
    empty_confirmed: creditSales.length === 0,
    note: "total_debt_created_ugx is debt created ON THIS DAY only — not the customer's total outstanding balance (use get_customer_summary for that).",
  };
}

/**
 * Shape shop_get_shift_sales's raw RPC row for the model. Mirrors
 * shapeShiftReportForModel's non-"ok" handling: every non-ok status
 * carries zero item data and an explicit note, never a substitute.
 */
export function shapeShiftSalesForModel(
  row: Record<string, unknown>,
  boundShopId: string,
): Record<string, unknown> {
  if (row.error === "shift_not_found") {
    return {
      status: "shift_not_found",
      note: "The requested shift was not found for this shop. Do not report today's sales instead.",
      shop_id: boundShopId,
    };
  }
  if (row.error === "no_shift_found") {
    return {
      status: "no_shift_found",
      note: "No open or recently closed shift exists for this shop. Do not substitute today's sales.",
      shop_id: boundShopId,
    };
  }
  if (row.error === "multiple_open_shifts") {
    return {
      status: "multiple_open_shifts",
      candidates: Array.isArray(row.candidates) ? row.candidates : [],
      note: "More than one staff member currently has an open shift. Ask the user which cashier/shift they mean.",
      shop_id: boundShopId,
    };
  }
  if (row.status === "shift_sales_not_supported") {
    return {
      status: "shift_sales_not_supported",
      shift_id: row.shift_id,
      note: row.note ?? "Item-level sales cannot be safely attributed to this shift.",
      shop_id: boundShopId,
    };
  }
  const products = minifyProducts(row.products, 20);
  return {
    status: "ok",
    shift_id: row.shift_id,
    start_at: row.start_at,
    end_at: row.end_at ?? null,
    transaction_count: row.transaction_count,
    products,
    empty_confirmed: products.length === 0,
    mismatch_note:
      Number(row.mismatched_seller_sales_count ?? 0) > 0
        ? `${row.mismatched_seller_sales_count} sale(s) in this shift show a different logged seller than the shift owner — figures still include them.`
        : null,
    shop_id: boundShopId,
  };
}

/** Shape shop_get_inventory_movements's raw RPC row for the model. */
export function shapeInventoryMovementsForModel(
  row: Record<string, unknown>,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const rowsRaw = Array.isArray(row.movements) ? (row.movements as Record<string, unknown>[]) : [];
  const movements = limitAskWakaRows(rowsRaw, 30).map((m) => ({
    name: m.name ?? "Item",
    quantity_delta: m.quantity_delta,
    reason: m.reason,
    occurred_at: m.occurred_at,
  }));
  return {
    scope: args.scope ?? "week",
    week: args.week ?? null,
    start_day: args.start_day ?? row.start_day,
    end_day: args.end_day ?? row.end_day,
    reason_filter: row.reason_filter ?? null,
    movements,
    empty_confirmed: movements.length === 0,
  };
}

export {
  answerRequiresToolData,
} from "./askWakaGuardrails";
