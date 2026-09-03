/**
 * ASK-INTEL-1 source router.
 * Distinguishes project/code/history vs live POS vs action vs general.
 * Does not replace POS tool contracts — it decides whether those tools should run.
 */

import { classifyAskWakaQuestion, type AskWakaClassification } from "./askWakaGuardrails";

export type AskWakaSourceLane =
  | "PROJECT"
  | "CODE"
  | "HISTORY"
  | "LIVE_POS"
  | "GENERAL"
  | "ACTION";

export type AskWakaSourceRoute = {
  lanes: AskWakaSourceLane[];
  mixed: boolean;
  actionKind: "write" | "sql" | null;
  refuse: boolean;
  needsKnowledge: boolean;
  offerPosTools: boolean;
  requirePosTools: boolean;
  /** Existing POS classifier — still used for tool selection when LIVE_POS. */
  posClassification: AskWakaClassification;
};

const MONTH_RE =
  /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/;
const YEAR_RE = /\b(20\d{2})\b/;

function includesAny(text: string, needles: readonly string[]): boolean {
  return needles.some((n) => text.includes(n));
}

function looksLivePosMetric(text: string): boolean {
  return includesAny(text, [
    "how much did we sell",
    "how much did i sell",
    "how much did we take",
    "sold today",
    "sell today",
    "sales today",
    "today's sales",
    "todays sales",
    "revenue",
    "low stock",
    "low in stock",
    "out of stock",
    "stock value",
    "how much stock",
    "outstanding debt",
    "how much debt",
    "top selling",
    "top products",
    "slow products",
    "how much did we spend",
    "how much did i spend",
    "expenses this",
    "staff sales",
    "who sold",
  ]) || (
    /\b(sell|sold|sales|cash|inventory|stock|expense|debt|customer|revenue)\b/.test(text) &&
    /\b(how much|how many|today|this week|last week|this month|last month|ugx)\b/.test(text)
  );
}

function looksEngineeringHistory(text: string): boolean {
  return includesAny(text, [
    "what did we work",
    "what we work",
    "what did we build",
    "what have we built",
    "what we built",
    "what we changed",
    "what did we change",
    "what changed",
    "what happened during",
    "what happened before",
    "what happened after",
    "what happened around",
    "engineering",
    "git history",
    "commit",
    "commits",
    "changelog",
    "release notes",
    "milestone",
    "milestones",
    "before mb-1",
    "after mb-1",
    "around mb-1",
  ]) || /\b(work on|worked on|shipped|introduced)\b/.test(text);
}

function looksProject(text: string, raw: string): boolean {
  if (
    includesAny(text, [
      "what is waka",
      "what's waka",
      "explain waka",
      "waka architecture",
      "waka system",
      "how is waka",
      "current architecture",
      "current limitations of ask waka",
      "ask waka",
      "why did we introduce",
      "why did we",
      "why was this",
      "why do we use",
      "why does waka",
      "architecture chosen",
      "design decision",
      "frozen",
      "which parts of waka",
      "offline persistence",
      "device isolation",
      "shop switching",
      "mb-1",
      "mb1",
      "sb:userid",
      "shopuuid",
    ])
  ) {
    return true;
  }
  if (/\b(waka|pos)\b/.test(text) && /\b(what|how|why|explain|architecture|system|built)\b/.test(text)) {
    return true;
  }
  if (/\b(settings|android startup|hardware)\b/.test(text) && /\b(decide|decision|why|change|architecture)\b/.test(text)) {
    return true;
  }
  return /\bmb-?1\b/i.test(raw);
}

function looksCode(text: string, raw: string): boolean {
  if (
    includesAny(text, [
      "how does",
      "where is",
      "where are",
      "implemented",
      "source code",
      "which file",
      "which function",
      "what calls",
      "show me how",
      "show me the code",
      "show me the source",
      "shopscope",
      "finalizedraftsale",
      "salefinancialengine",
      "active shop persistence",
      "receipt authorization",
      "device isolation",
      "device authorization",
      "complete a sale",
      "sale flow",
      "cash drawer",
      "drawer formula",
      "cash position",
      "is this tested",
      "is the sale flow tested",
      "test coverage",
      "handle stock",
      "handle inventory",
      "permissions handled",
      "how are permissions",
      "how does waka know which shop",
      "how does ask waka",
      "what part of waka",
      "how are sales and inventory connected",
    ])
  ) {
    return true;
  }
  if (/\b\w+\.(ts|tsx|js|sql)\b/.test(text)) return true;
  if (/\b(finalizeDraftSale|getPersistenceNamespace|saleFinancialEngine|SensitiveActionGate)\b/.test(raw)) {
    return true;
  }
  if (/[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*/.test(raw) && /\b(how|where|what|explain)\b/.test(text)) {
    return true;
  }
  return false;
}

function looksGeneral(text: string): boolean {
  return includesAny(text, [
    "explain this simply",
    "explain this error",
    "help me understand",
    "compare these",
    "give me ideas",
    "improving waka",
    "what should we improve",
    "dependency injection",
    "tell me a joke",
    "write a poem",
    "love letter",
    "world cup",
    "weather",
  ]);
}

/**
 * First-generation source router. ACTION still uses the existing write/SQL classifier.
 */
export function routeAskWakaSources(message: string): AskWakaSourceRoute {
  const posClassification = classifyAskWakaQuestion(message);
  if (posClassification.kind === "write_request") {
    return {
      lanes: ["ACTION"],
      mixed: false,
      actionKind: "write",
      refuse: true,
      needsKnowledge: false,
      offerPosTools: false,
      requirePosTools: false,
      posClassification,
    };
  }
  if (posClassification.kind === "sql_request") {
    return {
      lanes: ["ACTION"],
      mixed: false,
      actionKind: "sql",
      refuse: true,
      needsKnowledge: false,
      offerPosTools: false,
      requirePosTools: false,
      posClassification,
    };
  }

  const raw = message.trim();
  const text = raw.toLowerCase();
  const project = looksProject(text, raw);
  const code = looksCode(text, raw);
  const historyEng = looksEngineeringHistory(text);
  const liveMetric = looksLivePosMetric(text) || posClassification.kind === "quantitative";
  const hasCalendar = MONTH_RE.test(text) || YEAR_RE.test(text) || includesAny(text, ["last month", "last week", "recently"]);
  const general = looksGeneral(text);

  const historyFromCalendar =
    hasCalendar && historyEng && !liveMetric
      ? true
      : hasCalendar && !liveMetric && !code && (historyEng || /\bwhat (happened|changed)\b/.test(text));

  const history = historyEng || historyFromCalendar;

  const lanes: AskWakaSourceLane[] = [];
  if (project) lanes.push("PROJECT");
  if (code) lanes.push("CODE");
  if (history) lanes.push("HISTORY");

  const knowledgeIntent = project || code || history;
  const ambiguousHappened = hasCalendar && /\bwhat happened\b/.test(text) && !liveMetric && !historyEng;

  let livePos = false;
  if (liveMetric && !knowledgeIntent) {
    livePos = true;
  } else if (liveMetric && knowledgeIntent) {
    livePos = true;
  } else if (ambiguousHappened) {
    livePos = true;
    if (!lanes.includes("HISTORY")) lanes.push("HISTORY");
    if (!lanes.includes("PROJECT")) lanes.push("PROJECT");
  }

  if (livePos) lanes.push("LIVE_POS");
  if (general) lanes.push("GENERAL");

  if (!lanes.length) {
    if (posClassification.kind === "out_of_scope") {
      lanes.push("GENERAL");
    } else {
      lanes.push("GENERAL");
      if (/\bwaka\b/.test(text)) lanes.push("PROJECT");
    }
  }

  const unique = [...new Set(lanes)];
  const needsKnowledge = unique.some((l) => l === "PROJECT" || l === "CODE" || l === "HISTORY");
  const offerPosTools = unique.includes("LIVE_POS");
  const requirePosTools = offerPosTools && posClassification.kind === "quantitative";
  const mixed = needsKnowledge && offerPosTools;

  return {
    lanes: unique,
    mixed,
    actionKind: null,
    refuse: false,
    needsKnowledge,
    offerPosTools,
    requirePosTools,
    posClassification,
  };
}

export function isAskWakaActionLane(route: AskWakaSourceRoute): boolean {
  return route.refuse && route.lanes.includes("ACTION");
}
