import { useCallback, useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import type { WakaInternalAdminRow } from "../../../../lib/wakaInternalAdmin";
import { AI_FEATURES, type AiFeatureName } from "../../../../lib/ai/aiFeatures";
import {
  AI_PROVIDER_OPTIONS,
  DEEPSEEK_MODEL_OPTIONS,
  DEFAULT_PLATFORM_AI_SETTINGS_V2,
  type DeepSeekModel,
  type PlatformAiSettingsV2,
} from "../../../../lib/ai/platformAiSettings.v2";
import { fetchPlatformAiSettings } from "../../../../lib/ai/platformAiSettings";
import {
  adminUpdatePlatformAiSettings,
  fetchAiPlatformMetrics,
  type AiPlatformMetrics,
} from "../../../../lib/ai/platformAiAdmin";
import { isSuperAdmin, normalizeAdminRole } from "../adminRoles";
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
  deployed,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description?: string;
  deployed?: boolean;
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
        description={
          <>
            {description}
            {deployed === false ? (
              <span className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase text-amber-900">
                Not deployed
              </span>
            ) : null}
          </>
        }
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

const SECTION_FEATURES: Array<{ title: string; keys: AiFeatureName[] }> = [
  { title: "Product AI", keys: ["product_assistant"] },
  { title: "Vision AI", keys: ["product_scanner", "ocr", "barcode_detection"] },
  { title: "Business Setup AI", keys: ["business_setup_assistant"] },
  { title: "Inventory AI", keys: ["inventory_assistant", "restock_suggestions"] },
  { title: "Marketing AI", keys: ["marketing_assistant"] },
  { title: "Marketplace AI", keys: ["marketplace_assistant"] },
];

export function AdminAiSettingsPage({ adminRow, previewMode = false }: Props) {
  const role = normalizeAdminRole(adminRow?.role);
  const canEdit = isSuperAdmin(role) || role === "operations_admin" || previewMode;

  const [draft, setDraft] = useState<PlatformAiSettingsV2>(DEFAULT_PLATFORM_AI_SETTINGS_V2);
  const [metrics, setMetrics] = useState<AiPlatformMetrics | null>(null);
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
      });
      setLoading(false);
      return;
    }
    setLoading(true);
    const [{ settings }, m] = await Promise.all([fetchPlatformAiSettings(true), fetchAiPlatformMetrics(30)]);
    setDraft(settings);
    setMetrics(m);
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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-black text-foreground">
          <Sparkles className="h-5 w-5 text-waka-600" />
          AI Control Center
        </h1>
        <p className="text-xs font-semibold text-muted-foreground">
          Single source of truth for all AI features, limits, and providers. All flags default off.
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

      <AiStatusCard
        report={healthReport}
        loading={healthLoading}
        onRefresh={() => void runHealth(true)}
      />

      {metrics ? (
        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-black text-foreground">Usage &amp; cost (this month)</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "Total requests", value: metrics.totals.requests.toLocaleString() },
              { label: "Successful", value: metrics.totals.successful.toLocaleString() },
              { label: "Failed", value: metrics.totals.failed.toLocaleString() },
              { label: "Cache hits", value: metrics.totals.cacheHits.toLocaleString() },
              { label: "Cache misses", value: metrics.totals.cacheMisses.toLocaleString() },
              { label: "Est. cost (USD)", value: `$${metrics.totals.estimatedCostUsd.toFixed(2)}` },
              { label: "Avg latency", value: `${Math.round(metrics.totals.avgLatencyMs)} ms` },
              { label: "Requests left", value: metrics.limits.remainingRequests.toLocaleString() },
            ].map((m) => (
              <div key={m.label} className="rounded-xl border border-border bg-muted px-3 py-3">
                <p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">{m.label}</p>
                <p className="mt-1 text-lg font-black text-foreground">{m.value}</p>
              </div>
            ))}
          </div>
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
          {metrics.byShop.length > 0 ? (
            <div className="mt-4">
              <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">Top shops</p>
              <ul className="mt-2 space-y-1 text-sm">
                {metrics.byShop.map((r) => (
                  <li key={r.shop_id} className="flex justify-between font-semibold text-foreground">
                    <span className="truncate">{r.shop_name}</span>
                    <span>{r.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-black text-foreground">General</h2>
        <div className="space-y-3">
          <FeatureToggle
            label="Enable AI Platform"
            description="Master switch — when off, all AI is blocked and no provider costs are incurred."
            checked={draft.enabled}
            disabled={previewMode}
            onChange={(v) => setDraft({ ...draft, enabled: v })}
          />
          <label className={labelCls}>
            AI Provider
            <select
              className={inputCls}
              value={draft.provider}
              disabled={previewMode || masterOff}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  provider: e.target.value as PlatformAiSettingsV2["provider"],
                })
              }
            >
              {AI_PROVIDER_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          {draft.provider === "deepseek" ? (
            <label className={labelCls}>
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
        </div>
      </section>

      {SECTION_FEATURES.map((section) => (
        <section key={section.title} className="rounded-2xl border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-black text-foreground">{section.title}</h2>
          <div className="space-y-2">
            {section.keys.map((key) => {
              const meta = AI_FEATURES[key];
              return (
                <FeatureToggle
                  key={key}
                  label={meta.label}
                  description={meta.description}
                  deployed={meta.deployed}
                  checked={featureValue(draft, key)}
                  disabled={previewMode || masterOff}
                  onChange={(v) => setDraft(setFeature(draft, key, v))}
                />
              );
            })}
          </div>
        </section>
      ))}

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
          Set <code className="rounded bg-muted px-1">DEEPSEEK_API_KEY</code> in Supabase Edge secrets, then run{" "}
          <code className="rounded bg-muted px-1">npm run supabase:deploy:ai</code>.
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
