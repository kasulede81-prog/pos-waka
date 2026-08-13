/**
 * Ask WAKA quality / trust guardrails (testable client mirror).
 * Edge copy: supabase/functions/_shared/askWakaGuardrails.ts
 *
 * Structured flow: classify → required tools → successful tool result → final answer.
 * No fragile number regex parsing for claims.
 */

export type AskWakaToolName =
  | "get_today_sales"
  | "get_sales_for_period"
  | "get_week_comparison"
  | "get_top_products"
  | "get_slow_products"
  | "get_inventory_summary"
  | "get_low_stock_products"
  | "get_expense_summary"
  | "get_customer_summary"
  | "get_staff_sales_summary";

function isAskWakaToolName(value: string): value is AskWakaToolName {
  return value in ASK_WAKA_TOOL_LABELS;
}

export type AskWakaQuestionKind =
  | "quantitative"
  | "write_request"
  | "sql_request"
  | "out_of_scope"
  | "general_business";

export type AskWakaToolCategory =
  | "today_sales"
  | "period_sales"
  | "top_products"
  | "slow_products"
  | "inventory"
  | "low_stock"
  | "expenses"
  | "customers"
  | "staff_sales"
  | "comparison";

export type AskWakaClassification = {
  kind: AskWakaQuestionKind;
  categories: AskWakaToolCategory[];
  requiredTools: AskWakaToolName[];
  /** Primary tool to force-execute when the model skips tools. */
  primaryTool: AskWakaToolName | null;
  /** Server-resolved week for this/last/compare questions. */
  weekScope: "this" | "last" | "compare" | null;
};

export const ASK_WAKA_SAFE_TOOL_FAILURE =
  "I couldn't retrieve the latest POS figures right now. Please try again in a moment.";

export const ASK_WAKA_READ_ONLY_REFUSAL =
  "Ask WAKA is currently read-only. I can analyze your POS data, but I can't make changes like updating prices, stock, refunds, or expenses.";

export const ASK_WAKA_SQL_REFUSAL =
  "I can't run SQL or database commands. Ask WAKA is read-only and only answers from approved shop reports.";

export const ASK_WAKA_OUT_OF_SCOPE =
  "I'm focused on your WAKA POS business — sales, stock, expenses, customers, and staff performance. Ask me something about your shop.";

export const ASK_WAKA_TOOL_LABELS: Record<AskWakaToolName, string> = {
  get_today_sales: "Today's sales",
  get_sales_for_period: "Sales for the period",
  get_week_comparison: "Week comparison",
  get_top_products: "Top products",
  get_slow_products: "Slow products",
  get_inventory_summary: "Inventory",
  get_low_stock_products: "Low stock",
  get_expense_summary: "Expenses",
  get_customer_summary: "Customers",
  get_staff_sales_summary: "Staff sales",
};

const CATEGORY_TOOLS: Record<AskWakaToolCategory, AskWakaToolName[]> = {
  today_sales: ["get_today_sales"],
  period_sales: ["get_sales_for_period"],
  top_products: ["get_top_products"],
  slow_products: ["get_slow_products"],
  inventory: ["get_inventory_summary"],
  low_stock: ["get_low_stock_products"],
  expenses: ["get_expense_summary"],
  customers: ["get_customer_summary"],
  staff_sales: ["get_staff_sales_summary"],
  comparison: ["get_week_comparison"],
};

function includesAny(text: string, needles: readonly string[]): boolean {
  return needles.some((n) => text.includes(n));
}

/**
 * Classify the user question for tool enforcement / refusals.
 * Heuristic keyword matching — intentionally conservative for quantitative POS asks.
 */
export function classifyAskWakaQuestion(message: string): AskWakaClassification {
  const raw = message.trim();
  const text = raw.toLowerCase();

  // Write / mutation intents
  if (
    includesAny(text, [
      "delete",
      "refund",
      "void",
      "change price",
      "increase price",
      "decrease price",
      "update price",
      "adjust inventory",
      "adjust stock",
      "restock for me",
      "create an expense",
      "add an expense",
      "make a payment",
      "close the day",
      "open the drawer",
      "modify",
      "rename product",
      "remove product",
    ]) ||
    /\b(change|update|set|increase|decrease)\b.{0,40}\b(price|stock|inventory)\b/.test(text)
  ) {
    return { kind: "write_request", categories: [], requiredTools: [], primaryTool: null, weekScope: null };
  }

  // SQL / DB intents
  if (
    includesAny(text, ["select *", "drop table", "insert into", "alter table", "truncate ", "run this sql", "execute sql"]) ||
    /\b(sql|postgres|database query)\b/.test(text)
  ) {
    return { kind: "sql_request", categories: [], requiredTools: [], primaryTool: null, weekScope: null };
  }

  // Out of scope (non-business)
  if (
    includesAny(text, [
      "world cup",
      "love letter",
      "tell me a joke",
      "write a poem",
      "who won",
      "bitcoin price",
      "weather today",
      "recipe for",
    ]) ||
    (/^(hi|hello|hey)\b/.test(text) && text.length < 12)
  ) {
    // greetings alone → general_business (can answer without tools)
    if (/^(hi|hello|hey)[.!]?$/.test(text)) {
      return { kind: "general_business", categories: [], requiredTools: [], primaryTool: null, weekScope: null };
    }
    if (
      includesAny(text, [
        "world cup",
        "love letter",
        "tell me a joke",
        "write a poem",
        "who won",
        "bitcoin",
        "weather",
        "recipe",
      ])
    ) {
      return { kind: "out_of_scope", categories: [], requiredTools: [], primaryTool: null, weekScope: null };
    }
  }

  const categories: AskWakaToolCategory[] = [];

  if (
    includesAny(text, [
      "low stock",
      "low in stock",
      "low on stock",
      "running low",
      "out of stock",
      "reorder",
      "which items are low",
      "which products are low",
    ])
  ) {
    categories.push("low_stock");
  } else if (includesAny(text, ["inventory", "stock value", "stock status", "how much stock"])) {
    categories.push("inventory");
  }

  if (includesAny(text, ["top product", "best sell", "best-selling", "top selling", "what sold most", "fastest selling"])) {
    categories.push("top_products");
  }
  if (includesAny(text, ["slow product", "slowest", "not selling", "worst selling"])) {
    categories.push("slow_products");
  }

  if (includesAny(text, ["expense", "spent", "spending", "how much did i spend", "how much did we spend"])) {
    categories.push("expenses");
  }

  if (includesAny(text, ["customer", "debtor", "how many customers", "top customer"])) {
    categories.push("customers");
  }

  if (
    includesAny(text, [
      "staff",
      "cashier",
      "who sold",
      "sold the most",
      "employee sales",
      "which staff",
    ])
  ) {
    categories.push("staff_sales");
  }

  const asksThisWeek = includesAny(text, ["this week"]);
  const asksLastWeek = includesAny(text, ["last week"]);
  const asksCompare = includesAny(text, ["compare", "versus", "vs ", " vs"]);
  const asksSales =
    includesAny(text, ["sell", "sold", "sale", "sales", "revenue", "transaction", "cash"]);
  const asksTodayExplicit = includesAny(text, [
    "today",
    "leero",
    "sell today",
    "sold today",
    "sales today",
    "today's sales",
    "todays sales",
    "cash today",
  ]);

  let weekScope: AskWakaClassification["weekScope"] = null;
  if (asksCompare && (asksThisWeek || asksLastWeek || includesAny(text, ["week"]))) {
    weekScope = "compare";
    categories.push("comparison");
  } else if (asksLastWeek) {
    weekScope = "last";
  } else if (asksThisWeek) {
    weekScope = "this";
  }

  if (weekScope !== "compare") {
    if (asksTodayExplicit && asksSales && !asksThisWeek && !asksLastWeek) {
      categories.push("today_sales");
    } else if (
      !categories.length &&
      (asksThisWeek || asksLastWeek || includesAny(text, ["this month", "last month", "weekly", "monthly"])) &&
      asksSales
    ) {
      categories.push("period_sales");
    } else if (
      !categories.length &&
      /\b(how much|how many|total|revenue|ugx)\b/.test(text) &&
      asksSales
    ) {
      categories.push("today_sales");
    }
  }

  const uniqueCats = [...new Set(categories)];
  if (!uniqueCats.length) {
    // Soft quantitative: "how much" about business without clear category → treat as general
    if (/\b(how much|how many|total)\b/.test(text) && includesAny(text, ["shop", "business", "pos"])) {
      return {
        kind: "quantitative",
        categories: ["today_sales"],
        requiredTools: ["get_today_sales"],
        primaryTool: "get_today_sales",
        weekScope: null,
      };
    }
    return { kind: "general_business", categories: [], requiredTools: [], primaryTool: null, weekScope: null };
  }

  const requiredTools = [
    ...new Set(uniqueCats.flatMap((c) => CATEGORY_TOOLS[c])),
  ] as AskWakaToolName[];

  return {
    kind: "quantitative",
    categories: uniqueCats,
    requiredTools,
    primaryTool: requiredTools[0] ?? null,
    weekScope,
  };
}

/** True when at least one required tool for the classification succeeded. */
export function quantitativeToolsSatisfied(
  classification: AskWakaClassification,
  toolsUsed: readonly string[],
): boolean {
  if (classification.kind !== "quantitative") return true;
  if (!classification.requiredTools.length) return true;
  const used = new Set(toolsUsed.filter(isAskWakaToolName));
  return classification.requiredTools.some((t) => used.has(t));
}

/**
 * Final response guard for quantitative questions.
 * Does not parse numbers — uses structured tool success state only.
 */
export function guardAskWakaFinalAnswer(params: {
  classification: AskWakaClassification;
  toolsUsed: readonly string[];
  toolsFailed: boolean;
  answer: string | null;
}): {
  answer: string;
  blocked: boolean;
  reason: string | null;
} {
  const { classification, toolsUsed, toolsFailed, answer } = params;

  if (classification.kind === "write_request") {
    return { answer: ASK_WAKA_READ_ONLY_REFUSAL, blocked: true, reason: "write_request" };
  }
  if (classification.kind === "sql_request") {
    return { answer: ASK_WAKA_SQL_REFUSAL, blocked: true, reason: "sql_request" };
  }
  if (classification.kind === "out_of_scope") {
    return { answer: ASK_WAKA_OUT_OF_SCOPE, blocked: true, reason: "out_of_scope" };
  }

  if (classification.kind === "quantitative") {
    if (toolsFailed && toolsUsed.length === 0) {
      return { answer: ASK_WAKA_SAFE_TOOL_FAILURE, blocked: true, reason: "tools_failed" };
    }
    if (!quantitativeToolsSatisfied(classification, toolsUsed)) {
      return { answer: ASK_WAKA_SAFE_TOOL_FAILURE, blocked: true, reason: "missing_required_tools" };
    }
  }

  const cleaned = scrubInternalToolNamesFromAnswer((answer ?? "").trim());
  if (!cleaned) {
    return {
      answer: classification.kind === "quantitative" ? ASK_WAKA_SAFE_TOOL_FAILURE : "I could not produce an answer. Please rephrase your question.",
      blocked: true,
      reason: "empty_answer",
    };
  }

  return { answer: cleaned, blocked: false, reason: null };
}

/** Replace / remove raw tool identifiers from model prose. */
export function scrubInternalToolNamesFromAnswer(answer: string): string {
  let out = answer;
  for (const name of Object.keys(ASK_WAKA_TOOL_LABELS) as AskWakaToolName[]) {
    const label = ASK_WAKA_TOOL_LABELS[name];
    out = out.replaceAll(new RegExp(`\\b${name}\\b`, "gi"), label);
  }
  // Hide common RPC names if the model echoes them
  out = out.replace(/\bshop_get_[a-z0-9_]+\b/gi, "shop report");
  out = out.replace(/\brpc_[a-z0-9_]+\b/gi, "shop report");
  return out;
}

export function formatAskWakaToolLabel(toolName: string): string {
  if (isAskWakaToolName(toolName)) return ASK_WAKA_TOOL_LABELS[toolName];
  return "Shop report";
}

export function formatAskWakaToolLabels(tools: readonly string[]): string[] {
  const labels = tools.map(formatAskWakaToolLabel);
  return [...new Set(labels)];
}

/** Format UGX amounts without unnecessary decimals. */
export function formatUgxAmount(amount: number): string {
  if (!Number.isFinite(amount)) return "UGX 0";
  const n = Math.round(amount);
  return `UGX ${n.toLocaleString("en-UG")}`;
}

/** Human-readable data-as-of line from ISO timestamp. */
export function formatAskWakaDataAsOf(iso: string | null | undefined, locale = "en"): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  try {
    const formatted = d.toLocaleString(locale === "lg" ? "en-UG" : "en-UG", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    return `Data as of ${formatted}`;
  } catch {
    return `Data as of ${iso}`;
  }
}

/**
 * Ensure quantitative answers mention period/as-of when missing.
 * Appends a short as-of line; does not invent figures.
 */
export function ensureAskWakaDataAsOfInAnswer(answer: string, dataAsOfIso: string): string {
  const lower = answer.toLowerCase();
  if (lower.includes("as of") || lower.includes("data as of") || lower.includes("for today") || lower.includes("today (")) {
    return answer;
  }
  const line = formatAskWakaDataAsOf(dataAsOfIso);
  if (!line) return answer;
  return `${answer.trim()}\n\n${line}`;
}

/** Default args when server force-executes a required tool. */
export function defaultArgsForAskWakaTool(
  tool: AskWakaToolName,
  classification?: AskWakaClassification,
): Record<string, unknown> {
  switch (tool) {
    case "get_today_sales":
    case "get_inventory_summary":
    case "get_expense_summary":
    case "get_week_comparison":
      return {};
    case "get_sales_for_period":
      return { period: "week", week: classification?.weekScope === "last" ? "last" : "this" };
    case "get_top_products":
    case "get_slow_products":
      return { limit: 10, week: classification?.weekScope === "last" ? "last" : "this" };
    case "get_low_stock_products":
      return { limit: 15 };
    case "get_customer_summary":
    case "get_staff_sales_summary":
      return { limit: 10, week: classification?.weekScope === "last" ? "last" : "this" };
    default:
      return {};
  }
}

/** Backward-compatible helper used by older tests. */
export function answerRequiresToolData(
  toolsUsed: readonly string[],
  toolsFailed: boolean,
  classification?: AskWakaClassification,
): { forceSafeFailure: boolean; reason?: string } {
  if (toolsFailed && toolsUsed.length === 0) {
    return {
      forceSafeFailure: true,
      reason: "Required business data could not be retrieved. Please try again.",
    };
  }
  if (classification && classification.kind === "quantitative" && !quantitativeToolsSatisfied(classification, toolsUsed)) {
    return {
      forceSafeFailure: true,
      reason: "Required business data could not be retrieved. Please try again.",
    };
  }
  return { forceSafeFailure: false };
}

export function askWakaObservabilityTags(params: {
  classification: AskWakaClassification;
  toolsUsed: readonly string[];
  toolsFailed: boolean;
  blockedReason: string | null;
  providerFailed?: boolean;
}): string {
  const parts = [
    `kind=${params.classification.kind}`,
    `tools=${params.toolsUsed.join("+") || "none"}`,
    params.toolsFailed ? "tool_fail=1" : "tool_fail=0",
  ];
  if (params.blockedReason) parts.push(`block=${params.blockedReason}`);
  if (params.providerFailed) parts.push("provider_fail=1");
  return parts.join(";");
}
