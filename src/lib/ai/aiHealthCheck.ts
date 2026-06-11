import { supabase, hasSupabaseConfig } from "../supabase";
import { invokeSupabaseEdgeFunction } from "../supabaseEdgeInvoke";
import { fetchPlatformAiSettings } from "./platformAiSettings";

export type AiHealthComponentStatus = "ok" | "fail" | "warn";

export type AiHealthComponent = {
  id: string;
  label: string;
  status: AiHealthComponentStatus;
  detail?: string;
};

export type AiHealthReport = {
  healthy: boolean;
  checkedAt: string;
  components: AiHealthComponent[];
};

const AI_EDGE_FUNCTIONS = [
  { id: "edge:ai-suggest-product", slug: "ai-suggest-product", label: "ai-suggest-product" },
  { id: "edge:ai-business-setup", slug: "ai-business-setup", label: "ai-business-setup" },
  { id: "edge:ai-bulk-inventory", slug: "ai-bulk-inventory", label: "ai-bulk-inventory" },
  { id: "edge:ai-health", slug: "ai-health", label: "ai-health" },
] as const;

const REQUIRED_RPCS = [
  { id: "rpc:get_platform_ai_settings", name: "get_platform_ai_settings", label: "get_platform_ai_settings" },
  { id: "rpc:admin_ai_platform_metrics", name: "admin_ai_platform_metrics", label: "admin_ai_platform_metrics" },
] as const;

function isRpcMissingMessage(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("could not find the function") ||
    m.includes("function public.") ||
    m.includes("schema cache") ||
    m.includes("does not exist")
  );
}

async function probeEdgeFunctionDeployed(slug: string): Promise<{ deployed: boolean; detail?: string }> {
  const url = import.meta.env.VITE_SUPABASE_URL;
  if (!url) return { deployed: false, detail: "VITE_SUPABASE_URL not set" };

  try {
    const res = await fetch(`${String(url).replace(/\/$/, "")}/functions/v1/${slug}`, {
      method: "OPTIONS",
    });
    if (res.status === 404) return { deployed: false, detail: "HTTP 404 NOT_FOUND" };
    if (res.status === 200 || res.status === 204 || res.status === 401 || res.status === 405) {
      return { deployed: true };
    }
    return { deployed: true, detail: `HTTP ${res.status}` };
  } catch (e) {
    return { deployed: false, detail: e instanceof Error ? e.message : "probe_failed" };
  }
}

type AiHealthEdgePayload = {
  ok?: boolean;
  deepseek_key_configured?: boolean;
  error?: string;
  code?: string;
};

let cachedReport: AiHealthReport | null = null;
let cachedAt = 0;
const CACHE_MS = 30_000;

/**
 * Validates AI infrastructure for Internal Admin.
 * Safe to call on AI Settings page load (internal staff only).
 */
export async function runAiHealthCheck(force = false): Promise<AiHealthReport> {
  const now = Date.now();
  if (!force && cachedReport && now - cachedAt < CACHE_MS) {
    return cachedReport;
  }

  const components: AiHealthComponent[] = [];
  const fail = (id: string, label: string, detail: string) => {
    components.push({ id, label, status: "fail", detail });
  };
  const ok = (id: string, label: string, detail?: string) => {
    components.push({ id, label, status: "ok", detail });
  };
  const warn = (id: string, label: string, detail: string) => {
    components.push({ id, label, status: "warn", detail });
  };

  if (!hasSupabaseConfig || !supabase) {
    fail("settings:platform_ai", "AI settings", "Supabase not configured");
    return finalize(components);
  }

  const settingsResult = await fetchPlatformAiSettings(true);
  if (!settingsResult.fromServer) {
    const { error } = await supabase.rpc("get_platform_ai_settings");
    if (error && isRpcMissingMessage(error.message)) {
      fail("rpc:get_platform_ai_settings", "get_platform_ai_settings", error.message);
    } else {
      fail("settings:platform_ai", "AI settings", error?.message ?? "Could not load settings");
    }
  } else {
    ok("rpc:get_platform_ai_settings", "get_platform_ai_settings");
    const s = settingsResult.settings;
    if (!s.enabled) {
      warn("settings:platform_ai", "AI platform enabled", "Master switch is off");
    } else {
      ok("settings:platform_ai", "AI platform enabled");
    }
    if (!s.product_assistant) {
      warn("settings:product_assistant", "Product assistant flag", "Feature disabled in settings");
    } else {
      ok("settings:product_assistant", "Product assistant flag");
    }
  }

  for (const rpc of REQUIRED_RPCS) {
    if (rpc.name === "get_platform_ai_settings") continue;
    const { error } = await supabase.rpc(rpc.name, rpc.name === "admin_ai_platform_metrics" ? { p_days: 1 } : {});
    if (error) {
      if (isRpcMissingMessage(error.message)) {
        fail(rpc.id, rpc.label, error.message);
      } else if (error.message.toLowerCase().includes("forbidden")) {
        warn(rpc.id, rpc.label, "Requires internal admin session");
      } else {
        fail(rpc.id, rpc.label, error.message);
      }
    } else {
      ok(rpc.id, rpc.label);
    }
  }

  const edgeProbeResults = await Promise.all(
    AI_EDGE_FUNCTIONS.map(async (fn) => {
      const probe = await probeEdgeFunctionDeployed(fn.slug);
      return { fn, probe };
    }),
  );

  for (const { fn, probe } of edgeProbeResults) {
    if (probe.deployed) {
      ok(fn.id, fn.label, probe.detail);
    } else {
      fail(fn.id, fn.label, probe.detail ?? "Not deployed");
    }
  }

  const healthInvoke = await invokeSupabaseEdgeFunction<AiHealthEdgePayload>("ai-health", {});
  if (!healthInvoke.ok) {
    if (healthInvoke.errorCode === "function_not_deployed") {
      fail("secret:DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY", "Deploy ai-health to verify (npm run supabase:deploy:ai)");
    } else {
      fail("secret:DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY", healthInvoke.message);
    }
  } else {
    const data = healthInvoke.data;
    if (data.deepseek_key_configured === true) {
      ok("secret:DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY");
    } else {
      fail("secret:DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY", "Not set in Supabase Edge secrets");
    }
  }

  return finalize(components);
}

function finalize(components: AiHealthComponent[]): AiHealthReport {
  const healthy = components.every((c) => c.status === "ok");
  const report: AiHealthReport = {
    healthy,
    checkedAt: new Date().toISOString(),
    components,
  };
  cachedReport = report;
  cachedAt = Date.now();
  return report;
}

export function invalidateAiHealthCache(): void {
  cachedReport = null;
  cachedAt = 0;
}
