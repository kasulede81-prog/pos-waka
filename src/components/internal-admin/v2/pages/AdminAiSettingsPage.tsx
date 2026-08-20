import { useCallback, useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import type { WakaInternalAdminRow } from "../../../../lib/wakaInternalAdmin";
import {
  AI_FEATURES,
  COMING_SOON_AI_FEATURES,
  LIVE_AI_FEATURES,
  type AiFeatureName,
} from "../../../../lib/ai/aiFeatures";
import {
  DEEPSEEK_MODEL_OPTIONS,
  DEFAULT_PLATFORM_AI_SETTINGS_V2,
  UNAVAILABLE_PRODUCTION_AI_PROVIDERS,
  adminSelectableAiProviders,
  coerceAdminSelectableProvider,
  isOllamaProviderSelectable,
  type DeepSeekModel,
  type PlatformAiSettingsV2,
} from "../../../../lib/ai/platformAiSettings.v2";
import { DEFAULT_AI_PLAN_LIMITS } from "../../../../lib/ai/aiPlanEntitlements";
import { DEFAULT_AI_ROLE_ACCESS, type AiRoleAccess } from "../../../../lib/ai/aiAuthorization";
import { fetchPlatformAiSettings } from "../../../../lib/ai/platformAiSettings";
import {
  adminUpdatePlatformAiSettings,
  fetchAiAuthorizationSnapshot,
  fetchAiPlatformMetrics,
  type AiAuthorizationSnapshot,
  type AiPlatformMetrics,
} from "../../../../lib/ai/platformAiAdmin";
import { canManageAi, normalizeAdminRole } from "../adminRoles";
import { WakaSwitch } from "../../../enterprise/WakaSwitch";
import { AiStatusCard } from "../AiStatusCard";
import { runAiHealthCheck, type AiHealthReport } from "../../../../lib/ai/aiHealthCheck";

type Props = {
  adminRow: WakaInternalAdminRow | null;
  previewMode?: boolean;
};

const inputCls =
  "mt-1 min-h-[44px] w-full rounded-xl border border-border bg-card px-3 text-sm font-semibold text-foreground outline-none focus:border-waka-500";
const labelCls = "block text-[11px] font-black uppercase tracking-wide text-muted-foreground";

function FeatureToggle({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted px-4 py-3">
      <WakaSwitch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        label={label}
        description={description}
      />
    </div>
  );
}

function featureValue(settings: PlatformAiSettingsV2, key: AiFeatureName): boolean {
  return settings[key] === true;
}

function setFeature(settings: PlatformAiSettingsV2, key: AiFeatureName, value: boolean): PlatformAiSettingsV2 {
  return { ...settings, [key]: value };
}

function formatPlanLimit(n: number | null): string {
  return n == null ? "Unlimited / custom" : `${n.toLocaleString()} requests/month`;
}

export function AdminAiSettingsPage({ adminRow, previewMode = false }: Props) {
  const role = normalizeAdminRole(adminRow?.role);
  const canEdit = canManageAi(role) || previewMode;

  const [draft, setDraft] = useState<PlatformAiSettingsV2>(DEFAULT_PLATFORM_AI_SETTINGS_V2);
  const [metrics, setMetrics] = useState<AiPlatformMetrics | null>(null);
  const [authz, setAuthz] = useState<AiAuthorizationSnapshot | null>(null);
  const [loading, setLoading] = useState(!previewMode);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [healthReport, setHealthReport] = useState<AiHealthReport | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  const runHealth = useCallback(async (force = false) => {
    if (previewMode) {
      setHealthReport({
        healthy: true,
        checkedAt: new Date().toISOString(),
        components: [
          { id: "edge:ai-suggest-product", label: "ai-suggest-product", status: "ok" },
          { id: "secret:DEEPSEEK_API_KEY", label: "DEEPSEEK_API_KEY", status: "ok" },
          { id: "settings:platform_ai", label: "AI platform enabled", status: "ok" },
        ],
      });
      return;
    }
    setHealthLoading(true);
    const report = await runAiHealthCheck(force);
    setHealthReport(report);
    setHealthLoading(false);
  }, [previewMode]);

  const load = useCallback(async () => {
    if (previewMode) {
      setDraft({
        ...DEFAULT_PLATFORM_AI_SETTINGS_V2,
        enabled: true,
        product_assistant: true,
        business_setup_assistant: true,
        inventory_assistant: true,
        ask_waka: true,
      });
      setMetrics({
        totals: {
          requests: 500,
          successful: 480,
          failed: 20,
          cacheHits: 380,
          cacheMisses: 120,
          estimatedCostUsd: 4.2,
          avgLatencyMs: 840,
        },
        today: { requests: 12, failed: 1, estimatedCostUsd: 0.08 },
        limits: {
          monthlyRequestLimit: 20000,
          monthlyBudgetLimit: 50,
          remainingRequests: 19500,
          remainingBudgetUsd: 45.8,
        },
        byFeature: [
          { feature: "product_assistant", count: 200, costUsd: 1.2 },
          { feature: "inventory_assistant", count: 80, costUsd: 2.5 },
        ],
        byShop: [{ shop_id: "preview", shop_name: "Demo Shop", count: 45 }],
        byError: [{ reason: "quota exceeded", count: 3 }],
      });
      setAuthz({
        enabled: true,
        roleAccess: { ...DEFAULT_AI_ROLE_ACCESS },
        authorizedShopCount: 1,
        authorizedUserCount: 2,
        authorizedShops: [
          {
            shopId: "preview",
            shopName: "Demo Shop",
            productAssistant: true,
            inventoryAssistant: true,
            businessSetupAssistant: true,
            askWaka: true,
            monthlyRequestLimit: 500,
            planCode: "starter",
            requestsThisMonth: 45,
          },
        ],
        authorizedUsers: [
          {
            userId: "u1",
            fullName: "Shop Owner",
            role: "owner",
            roleBucket: "owner",
            shopId: "preview",
            shopName: "Demo Shop",
            requestsThisMonth: 30,
          },
          {
            userId: "u2",
            fullName: "Store Manager",
            role: "manager",
            roleBucket: "manager",
            shopId: "preview",
            shopName: "Demo Shop",
            requestsThisMonth: 15,
          },
        ],
      });
      setLoading(false);
      return;
    }
    setLoading(true);
    const [{ settings }, m, a] = await Promise.all([
      fetchPlatformAiSettings(true),
      fetchAiPlatformMetrics(30),
      fetchAiAuthorizationSnapshot(),
    ]);
    setDraft(settings);
    setMetrics(m);
    setAuthz(a);
    setLoading(false);
    void runHealth(true);
  }, [previewMode, runHealth]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!canEdit || saving || previewMode) return;
    setSaving(true);
    setErr(null);
    setNotice(null);
    const res = await adminUpdatePlatformAiSettings(draft);
    setSaving(false);
    if (!res.ok) {
      setErr(res.error ?? "Save failed");
      return;
    }
    setNotice("AI Control Center settings saved.");
    await load();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-waka-600" />
      </div>
    );
  }

  if (!canEdit) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-card p-6 text-center text-sm font-bold text-rose-800">
        Super admin or operations admin only.
      </div>
    );
  }

  const masterOff = !draft.enabled;
  const selectable = adminSelectableAiProviders();
  const liveProvider = coerceAdminSelectableProvider(draft.provider);
  const unimplementedStored =
    draft.provider !== "deepseek" && draft.provider !== "ollama";
  const planLimits = draft.plan_limits ?? DEFAULT_AI_PLAN_LIMITS;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-black text-foreground">
          <Sparkles className="h-5 w-5 text-waka-600" />
          AI Control Center
        </h1>
        <p className="text-xs font-semibold text-muted-foreground">
          Master switch and live features only. Default is off. No provider secrets in this app.
        </p>
      </div>

      {notice ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900">
          {notice}
        </div>
      ) : null}
      {err ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-900">
          {err}
        </div>
      ) : null}

      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <p className="text-[11px] font-black uppercase tracking-wide text-muted-foreground">AI system</p>
        <p className={`mt-1 text-lg font-black ${draft.enabled ? "text-emerald-700" : "text-rose-800"}`}>
          {draft.enabled ? "ENABLED" : "DISABLED"}
        </p>
        <p className="mt-2 text-sm font-semibold text-muted-foreground">
          {draft.enabled
            ? "Edge AI may run only for live features on authorized shops and authorized shop roles."
            : "No Edge calls, no generation, no AI spend. All features are blocked."}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={previewMode || draft.enabled}
            onClick={() => setDraft({ ...draft, enabled: true })}
            className="min-h-[40px] rounded-xl bg-waka-600 px-4 text-xs font-black text-white disabled:bg-muted disabled:text-muted-foreground"
          >
            Enable AI
          </button>
          <button
            type="button"
            disabled={previewMode || !draft.enabled}
            onClick={() => setDraft({ ...draft, enabled: false })}
            className="min-h-[40px] rounded-xl border border-border px-4 text-xs font-black disabled:opacity-40"
          >
            Disable AI
          </button>
        </div>
        {previewMode ? (
          <p className="mt-3 text-xs font-semibold text-amber-800">Preview mode — master switch is read-only.</p>
        ) : (
          <p className="mt-3 text-xs font-semibold text-muted-foreground">Save to apply. Super admin and operations admin only.</p>
        )}
      </section>

      <AiStatusCard
        report={healthReport}
        loading={healthLoading}
        onRefresh={() => void runHealth(true)}
      />

      {metrics ? (
        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-black text-foreground">AI usage</h2>
          <p className="mb-3 text-[11px] font-black uppercase tracking-wide text-muted-foreground">Today</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[
              { label: "Requests", value: metrics.today.requests.toLocaleString() },
              { label: "Estimated cost", value: `$${metrics.today.estimatedCostUsd.toFixed(2)}` },
              { label: "Errors", value: metrics.today.failed.toLocaleString() },
            ].map((m) => (
              <div key={m.label} className="rounded-xl border border-border bg-muted px-3 py-3">
                <p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">{m.label}</p>
                <p className="mt-1 text-lg font-black text-foreground">{m.value}</p>
              </div>
            ))}
          </div>
          <p className="mb-3 mt-4 text-[11px] font-black uppercase tracking-wide text-muted-foreground">This month</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "Total requests", value: metrics.totals.requests.toLocaleString() },
              { label: "Successful", value: metrics.totals.successful.toLocaleString() },
              { label: "Failed", value: metrics.totals.failed.toLocaleString() },
              { label: "Est. cost (USD)", value: `$${metrics.totals.estimatedCostUsd.toFixed(2)}` },
              { label: "Cache hits", value: metrics.totals.cacheHits.toLocaleString() },
              { label: "Avg latency", value: `${Math.round(metrics.totals.avgLatencyMs)} ms` },
              { label: "Requests left", value: metrics.limits.remainingRequests.toLocaleString() },
              { label: "Budget left", value: `$${metrics.limits.remainingBudgetUsd.toFixed(2)}` },
            ].map((m) => (
              <div key={m.label} className="rounded-xl border border-border bg-muted px-3 py-3">
                <p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">{m.label}</p>
                <p className="mt-1 text-lg font-black text-foreground">{m.value}</p>
              </div>
            ))}
          </div>
          {metrics.byShop.length > 0 ? (
            <div className="mt-4">
              <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">Top shops</p>
              <ul className="mt-2 space-y-1 text-sm">
                {metrics.byShop.map((r, i) => (
                  <li key={r.shop_id} className="flex justify-between font-semibold text-foreground">
                    <span className="truncate">
                      {i + 1}. {r.shop_name}
                    </span>
                    <span>{r.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {metrics.byError.length > 0 ? (
            <div className="mt-4">
              <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">Errors</p>
              <ul className="mt-2 space-y-1 text-sm">
                {metrics.byError.map((r) => (
                  <li key={r.reason} className="flex justify-between gap-3 font-semibold text-foreground">
                    <span className="truncate">{r.reason}</span>
                    <span>{r.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {metrics.byFeature.length > 0 ? (
            <div className="mt-4">
              <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">By feature</p>
              <ul className="mt-2 space-y-1 text-sm">
                {metrics.byFeature.map((r) => (
                  <li key={r.feature} className="flex justify-between font-semibold text-foreground">
                    <span>{r.feature}</span>
                    <span>
                      {r.count} · ${r.costUsd.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-black text-foreground">Provider</h2>
        <ul className="space-y-2">
          <li className="flex items-center justify-between rounded-xl border border-border bg-muted px-4 py-3">
            <span className="text-sm font-bold text-foreground">DeepSeek</span>
            <span className="text-xs font-black uppercase tracking-wide text-emerald-700">Available</span>
          </li>
          {UNAVAILABLE_PRODUCTION_AI_PROVIDERS.map((p) => (
            <li
              key={p}
              className="flex items-center justify-between rounded-xl border border-border bg-muted/60 px-4 py-3"
            >
              <span className="text-sm font-bold capitalize text-muted-foreground">{p}</span>
              <span className="text-xs font-black uppercase tracking-wide text-muted-foreground">Not configured</span>
            </li>
          ))}
          {isOllamaProviderSelectable() ? (
            <li className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <span className="text-sm font-bold text-foreground">Ollama</span>
              <span className="text-xs font-black uppercase tracking-wide text-amber-900">Local / staging only</span>
            </li>
          ) : null}
        </ul>
        {unimplementedStored ? (
          <p className="mt-3 text-xs font-semibold text-amber-900">
            Stored provider is not implemented. Saving will switch to DeepSeek.
          </p>
        ) : null}
        {selectable.includes("ollama") ? (
          <label className={`${labelCls} mt-3`}>
            Active provider (staging / local)
            <select
              className={inputCls}
              value={liveProvider}
              disabled={previewMode || masterOff}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  provider: coerceAdminSelectableProvider(e.target.value),
                })
              }
            >
              {selectable.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {liveProvider === "deepseek" || draft.provider === "deepseek" ? (
          <label className={`${labelCls} mt-3`}>
            DeepSeek model
            <select
              className={inputCls}
              value={draft.provider_config.deepseek_model ?? "deepseek-chat"}
              disabled={previewMode || masterOff}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  provider_config: {
                    ...draft.provider_config,
                    deepseek_model: e.target.value as DeepSeekModel,
                  },
                })
              }
            >
              {DEEPSEEK_MODEL_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <p className="mt-3 text-xs text-muted-foreground">
          Set <code className="rounded bg-muted px-1">DEEPSEEK_API_KEY</code> in Supabase Edge secrets. Never paste keys here.
        </p>
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-1 text-sm font-black text-foreground">Live AI features</h2>
        <p className="mb-3 text-xs font-semibold text-muted-foreground">
          Only deployed Edge features can be enabled. Master switch must be on.
        </p>
        <div className="space-y-2">
          {LIVE_AI_FEATURES.map((key) => {
            const meta = AI_FEATURES[key];
            return (
              <FeatureToggle
                key={key}
                label={meta.label}
                description={meta.description}
                checked={featureValue(draft, key)}
                disabled={previewMode || masterOff}
                onChange={(v) => setDraft(setFeature(draft, key, v))}
              />
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-dashed border-border bg-muted/40 p-4">
        <h2 className="mb-1 text-sm font-black text-muted-foreground">Coming soon</h2>
        <p className="mb-3 text-xs font-semibold text-muted-foreground">Not deployed. These cannot be turned on.</p>
        <ul className="space-y-2">
          {COMING_SOON_AI_FEATURES.map((key) => (
            <li
              key={key}
              className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3"
            >
              <span className="text-sm font-bold text-muted-foreground">{AI_FEATURES[key].label}</span>
              <span className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">Not deployed</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-1 text-sm font-black text-foreground">Shop &amp; user authorization</h2>
        <p className="mb-3 text-xs font-semibold text-muted-foreground">
          Shops must be explicitly authorized. Users inherit access from their shop membership role. Cashiers are off
          by default. The server enforces this — the POS UI is only a preview.
        </p>
        <div className="mb-4 space-y-2">
          {(
            [
              ["owner", "Owner"],
              ["manager", "Manager / supervisor"],
              ["cashier", "Cashier and other shop roles"],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="rounded-xl border border-border bg-muted px-4 py-3">
              <WakaSwitch
                checked={draft.role_access?.[key] ?? DEFAULT_AI_ROLE_ACCESS[key]}
                disabled={previewMode || masterOff}
                onCheckedChange={(v) =>
                  setDraft({
                    ...draft,
                    role_access: {
                      ...(draft.role_access ?? DEFAULT_AI_ROLE_ACCESS),
                      [key]: v,
                    } satisfies AiRoleAccess,
                  })
                }
                label={label}
              />
            </div>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border bg-muted px-3 py-3">
            <p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">Authorized shops</p>
            <p className="mt-1 text-lg font-black text-foreground">{authz?.authorizedShopCount ?? 0}</p>
          </div>
          <div className="rounded-xl border border-border bg-muted px-3 py-3">
            <p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">Authorized users</p>
            <p className="mt-1 text-lg font-black text-foreground">{authz?.authorizedUserCount ?? 0}</p>
          </div>
        </div>
        {authz?.authorizedShops.length ? (
          <div className="mt-4">
            <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">Authorized shops</p>
            <ul className="mt-2 space-y-1 text-sm">
              {authz.authorizedShops.map((s) => (
                <li key={s.shopId} className="flex justify-between gap-3 font-semibold text-foreground">
                  <span className="truncate">
                    {s.shopName}
                    <span className="ml-2 text-xs font-bold text-muted-foreground">{s.planCode}</span>
                  </span>
                  <span className="shrink-0 text-xs">{s.requestsThisMonth} req</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs font-semibold text-muted-foreground">
              Toggle a shop in Shop Console → AI. New shops stay off until authorized.
            </p>
          </div>
        ) : (
          <p className="mt-3 text-xs font-semibold text-muted-foreground">
            No authorized shops yet. Enable AI on a shop in Shop Console → AI.
          </p>
        )}
        {authz?.authorizedUsers.length ? (
          <div className="mt-4">
            <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">Authorized users</p>
            <ul className="mt-2 space-y-1 text-sm">
              {authz.authorizedUsers.map((u) => (
                <li key={`${u.userId}-${u.shopId}`} className="flex justify-between gap-3 font-semibold text-foreground">
                  <span className="truncate">
                    {u.fullName}
                    <span className="ml-2 text-xs font-bold capitalize text-muted-foreground">
                      {u.role} · {u.shopName}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs">{u.requestsThisMonth} req</span>
                </li>
              ))}
            </ul>
            {authz.authorizedUserCount > authz.authorizedUsers.length ? (
              <p className="mt-2 text-xs font-semibold text-muted-foreground">
                Showing {authz.authorizedUsers.length} of {authz.authorizedUserCount}.
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-1 text-sm font-black text-foreground">Subscription entitlements</h2>
        <p className="mb-3 text-xs font-semibold text-muted-foreground">
          Enforced server-side as a shop monthly ceiling from the shop&apos;s WAKA plan. Enterprise is unlimited unless
          a shop monthly limit is set.
        </p>
        <ul className="space-y-2 text-sm font-semibold text-foreground">
          <li className="flex justify-between rounded-xl border border-border bg-muted px-4 py-2">
            <span>Free</span>
            <span>{formatPlanLimit(planLimits.free)}</span>
          </li>
          <li className="flex justify-between rounded-xl border border-border bg-muted px-4 py-2">
            <span>Starter</span>
            <span>{formatPlanLimit(planLimits.starter)}</span>
          </li>
          <li className="flex justify-between rounded-xl border border-border bg-muted px-4 py-2">
            <span>Business</span>
            <span>{formatPlanLimit(planLimits.business)}</span>
          </li>
          <li className="flex justify-between rounded-xl border border-border bg-muted px-4 py-2">
            <span>Enterprise</span>
            <span>{formatPlanLimit(planLimits.enterprise)}</span>
          </li>
        </ul>
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-black text-foreground">Limits &amp; cost controls</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ["monthly_request_limit", "Monthly request limit"],
              ["monthly_budget_limit", "Monthly budget limit (USD)"],
              ["per_shop_limit", "Per shop limit"],
              ["per_user_limit", "Per user limit"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className={labelCls}>
              {label}
              <input
                type="number"
                min={0}
                className={inputCls}
                value={draft[key]}
                disabled={previewMode}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    [key]: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                  })
                }
              />
            </label>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Cache hits count toward request limits but not budget limits.
        </p>
      </section>

      <button
        type="button"
        disabled={saving || previewMode}
        onClick={() => void save()}
        className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-waka-600 text-sm font-black text-white hover:bg-waka-700 disabled:opacity-60"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Save AI Control Center
      </button>
    </div>
  );
}
