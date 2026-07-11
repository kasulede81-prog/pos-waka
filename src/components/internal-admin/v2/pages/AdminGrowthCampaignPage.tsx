import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Megaphone, Plus, RefreshCw, Ticket } from "lucide-react";
import type { WakaInternalAdminRow } from "../../../../lib/wakaInternalAdmin";
import {
  GROWTH_GRANT_MODES,
  PROMOTIONAL_PLAN_CODES,
  isCampaignActive,
  promotionalPlanLabel,
  type CampaignMetrics,
  type GrowthCampaign,
  type GrowthGrantMode,
  type PromotionalPlanCode,
} from "../../../../lib/growthCampaigns";
import {
  fetchGrowthCampaignMetrics,
  fetchGrowthCampaigns,
  fetchGrowthReferralCodes,
  saveGrowthCampaign,
  saveGrowthReferralCode,
  type GrowthReferralCodeWithUsage,
} from "../../../../lib/growthCampaignsAdmin";
import { WakaSwitch } from "../../../enterprise/WakaSwitch";

type Props = {
  adminRow: WakaInternalAdminRow | null;
  previewMode?: boolean;
};

type CampaignDraft = {
  id: string | null;
  name: string;
  description: string;
  enabled: boolean;
  grantMode: GrowthGrantMode;
  grantedPlanCode: PromotionalPlanCode;
  durationDays: string;
  startsAt: string;
  endsAt: string;
};

const EMPTY_DRAFT: CampaignDraft = {
  id: null,
  name: "",
  description: "",
  enabled: false,
  grantMode: "automatic",
  grantedPlanCode: "business",
  durationDays: "180",
  startsAt: "",
  endsAt: "",
};

type CodeDraft = {
  id: string | null;
  code: string;
  description: string;
  planCode: PromotionalPlanCode;
  durationDays: string;
  enabled: boolean;
};

const EMPTY_CODE_DRAFT: CodeDraft = {
  id: null,
  code: "",
  description: "",
  planCode: "business",
  durationDays: "180",
  enabled: true,
};

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocal(value: string): string | null {
  if (!value.trim()) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

const GRANT_MODE_LABELS: Record<GrowthGrantMode, string> = {
  automatic: "Automatic — every new shop",
  referral_based: "Referral based — only with a code",
  manual: "Manual — admin grants only",
};

const inputCls =
  "w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-semibold text-foreground outline-none focus:border-waka-500";
const labelCls = "mb-1 block text-[11px] font-black uppercase tracking-wide text-muted-foreground";

export function AdminGrowthCampaignPage({ previewMode = false }: Props) {
  const [loading, setLoading] = useState(true);
  const [campaigns, setCampaigns] = useState<GrowthCampaign[]>([]);
  const [codes, setCodes] = useState<GrowthReferralCodeWithUsage[]>([]);
  const [draft, setDraft] = useState<CampaignDraft>(EMPTY_DRAFT);
  const [codeDraft, setCodeDraft] = useState<CodeDraft>(EMPTY_CODE_DRAFT);
  const [saving, setSaving] = useState(false);
  const [savingCode, setSavingCode] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [metrics, setMetrics] = useState<CampaignMetrics | null>(null);
  const [metricsCampaignId, setMetricsCampaignId] = useState<string>("");
  const [metricsFrom, setMetricsFrom] = useState<string>("");
  const [metricsTo, setMetricsTo] = useState<string>("");
  const [metricsLoading, setMetricsLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [campaignRows, codeRows] = await Promise.all([fetchGrowthCampaigns(), fetchGrowthReferralCodes()]);
    setCampaigns(campaignRows);
    setCodes(codeRows);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (previewMode) {
      setLoading(false);
      return;
    }
    void load();
  }, [load, previewMode]);

  const loadMetrics = useCallback(async () => {
    setMetricsLoading(true);
    const result = await fetchGrowthCampaignMetrics({
      campaignId: metricsCampaignId || null,
      from: fromDatetimeLocal(metricsFrom),
      to: fromDatetimeLocal(metricsTo),
    });
    setMetrics(result);
    setMetricsLoading(false);
  }, [metricsCampaignId, metricsFrom, metricsTo]);

  useEffect(() => {
    if (previewMode) return;
    void loadMetrics();
  }, [loadMetrics, previewMode]);

  const selectCampaign = (c: GrowthCampaign) => {
    setDraft({
      id: c.id,
      name: c.name,
      description: c.description,
      enabled: c.enabled,
      grantMode: c.grantMode,
      grantedPlanCode: c.grantedPlanCode,
      durationDays: String(c.durationDays),
      startsAt: toDatetimeLocal(c.startsAt),
      endsAt: toDatetimeLocal(c.endsAt),
    });
  };

  const draftCampaignForActive: GrowthCampaign | null = useMemo(() => {
    const days = Number(draft.durationDays);
    return {
      id: draft.id ?? "draft",
      name: draft.name,
      description: draft.description,
      enabled: draft.enabled,
      grantMode: draft.grantMode,
      grantedPlanCode: draft.grantedPlanCode,
      durationDays: Number.isFinite(days) ? days : 0,
      startsAt: fromDatetimeLocal(draft.startsAt),
      endsAt: fromDatetimeLocal(draft.endsAt),
    };
  }, [draft]);

  const campaignActive = isCampaignActive(draftCampaignForActive);

  const handleSaveCampaign = async () => {
    if (previewMode || saving) return;
    const days = Number(draft.durationDays);
    if (!draft.name.trim()) {
      setNotice("Campaign name is required.");
      return;
    }
    if (!Number.isFinite(days) || days < 1) {
      setNotice("Duration days must be at least 1.");
      return;
    }
    setSaving(true);
    setNotice(null);
    const res = await saveGrowthCampaign({
      id: draft.id,
      name: draft.name.trim(),
      description: draft.description,
      enabled: draft.enabled,
      grantMode: draft.grantMode,
      grantedPlanCode: draft.grantedPlanCode,
      durationDays: Math.floor(days),
      startsAt: fromDatetimeLocal(draft.startsAt),
      endsAt: fromDatetimeLocal(draft.endsAt),
    });
    setSaving(false);
    if (!res.ok) {
      setNotice(`Save failed: ${res.error ?? "unknown error"}`);
      return;
    }
    setNotice("Campaign saved.");
    if (res.campaignId) setDraft((d) => ({ ...d, id: res.campaignId ?? d.id }));
    await load();
  };

  const handleSaveCode = async () => {
    if (previewMode || savingCode) return;
    const days = Number(codeDraft.durationDays);
    if (!codeDraft.code.trim()) {
      setNotice("Referral code is required.");
      return;
    }
    if (!Number.isFinite(days) || days < 1) {
      setNotice("Code duration days must be at least 1.");
      return;
    }
    setSavingCode(true);
    setNotice(null);
    const res = await saveGrowthReferralCode({
      id: codeDraft.id,
      campaignId: draft.id,
      code: codeDraft.code.trim().toUpperCase(),
      description: codeDraft.description,
      planCode: codeDraft.planCode,
      durationDays: Math.floor(days),
      enabled: codeDraft.enabled,
    });
    setSavingCode(false);
    if (!res.ok) {
      setNotice(`Code save failed: ${res.error ?? "unknown error"}`);
      return;
    }
    setCodeDraft(EMPTY_CODE_DRAFT);
    setNotice("Referral code saved.");
    await load();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-waka-600" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-black text-foreground">Monetization · Growth Campaign</h1>
          <p className="text-xs font-semibold text-muted-foreground">
            Temporary promotional plan grants. The paid subscription system stays fully active.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="flex min-h-[44px] items-center gap-1 rounded-xl bg-muted px-3 text-xs font-black text-muted-foreground hover:bg-muted"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      {notice ? (
        <div className="rounded-2xl border border-waka-200 bg-waka-50 px-4 py-3 text-sm font-bold text-waka-900">
          {notice}
        </div>
      ) : null}

      {/* Campaign list */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-black text-foreground">
            <Megaphone className="h-4 w-4 text-waka-600" /> Campaigns
          </h2>
          <button
            type="button"
            onClick={() => setDraft(EMPTY_DRAFT)}
            className="flex min-h-[40px] items-center gap-1 rounded-xl bg-waka-600 px-3 text-xs font-black text-white hover:bg-waka-700"
          >
            <Plus className="h-4 w-4" /> New campaign
          </button>
        </div>
        {campaigns.length === 0 ? (
          <p className="text-sm font-semibold text-muted-foreground">No campaigns yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {campaigns.map((c) => {
              const active = isCampaignActive(c);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => selectCampaign(c)}
                    className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left text-sm font-bold ${
                      draft.id === c.id
                        ? "border-waka-400 bg-waka-50 text-waka-900"
                        : "border-border bg-muted text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    <span className="truncate">{c.name || "(unnamed)"}</span>
                    <span
                      className={`ml-2 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${
                        active ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {active ? "Active" : c.enabled ? "Scheduled" : "Off"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Campaign editor */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-black text-foreground">
            {draft.id ? "Edit campaign" : "New campaign"}
          </h2>
          <span
            className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${
              campaignActive ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground"
            }`}
          >
            Campaign {campaignActive ? "Active" : "Inactive"}
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={labelCls}>Campaign name</label>
            <input
              className={inputCls}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="e.g. Uganda Launch 2026"
            />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Campaign description</label>
            <textarea
              className={`${inputCls} min-h-[64px]`}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="What this campaign is for"
            />
          </div>
          <div>
            <label className={labelCls}>Grant mode</label>
            <select
              className={inputCls}
              value={draft.grantMode}
              onChange={(e) => setDraft({ ...draft, grantMode: e.target.value as GrowthGrantMode })}
            >
              {GROWTH_GRANT_MODES.map((m) => (
                <option key={m} value={m}>
                  {GRANT_MODE_LABELS[m]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Granted plan</label>
            <select
              className={inputCls}
              value={draft.grantedPlanCode}
              onChange={(e) => setDraft({ ...draft, grantedPlanCode: e.target.value as PromotionalPlanCode })}
            >
              {PROMOTIONAL_PLAN_CODES.map((p) => (
                <option key={p} value={p}>
                  {promotionalPlanLabel(p)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Duration days</label>
            <input
              type="number"
              min={1}
              className={inputCls}
              value={draft.durationDays}
              onChange={(e) => setDraft({ ...draft, durationDays: e.target.value })}
            />
          </div>
          <div className="flex items-end">
            <WakaSwitch
              checked={draft.enabled}
              onCheckedChange={(checked) => setDraft({ ...draft, enabled: checked })}
              label="Enable Growth Campaign"
              className="text-sm font-black text-foreground"
            />
          </div>
          <div>
            <label className={labelCls}>Campaign start date</label>
            <input
              type="datetime-local"
              className={inputCls}
              value={draft.startsAt}
              onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })}
            />
          </div>
          <div>
            <label className={labelCls}>Campaign end date</label>
            <input
              type="datetime-local"
              className={inputCls}
              value={draft.endsAt}
              onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })}
            />
          </div>
        </div>

        <button
          type="button"
          disabled={saving || previewMode}
          onClick={() => void handleSaveCampaign()}
          className="mt-4 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-waka-600 px-4 text-sm font-black text-white hover:bg-waka-700 disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save campaign
        </button>
      </section>

      {/* Referral codes */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-black text-foreground">
          <Ticket className="h-4 w-4 text-waka-600" /> Referral codes
        </h2>

        {codes.length === 0 ? (
          <p className="mb-3 text-sm font-semibold text-muted-foreground">No referral codes yet.</p>
        ) : (
          <div className="mb-3 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead>
                <tr className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-1.5">Code</th>
                  <th className="px-2 py-1.5">Plan</th>
                  <th className="px-2 py-1.5">Days</th>
                  <th className="px-2 py-1.5">Used</th>
                  <th className="px-2 py-1.5">Enabled</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {codes.map((c) => (
                  <tr key={c.id} className="border-t border-border font-semibold text-foreground">
                    <td className="px-2 py-2 font-black">{c.code}</td>
                    <td className="px-2 py-2">{promotionalPlanLabel(c.planCode)}</td>
                    <td className="px-2 py-2">{c.durationDays}</td>
                    <td className="px-2 py-2">{c.usageCount}</td>
                    <td className="px-2 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${
                          c.enabled ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {c.enabled ? "On" : "Off"}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          setCodeDraft({
                            id: c.id,
                            code: c.code,
                            description: c.description,
                            planCode: c.planCode,
                            durationDays: String(c.durationDays),
                            enabled: c.enabled,
                          })
                        }
                        className="rounded-lg bg-muted px-2.5 py-1.5 text-xs font-black text-muted-foreground hover:bg-muted"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Code</label>
            <input
              className={inputCls}
              value={codeDraft.code}
              onChange={(e) => setCodeDraft({ ...codeDraft, code: e.target.value.toUpperCase() })}
              placeholder="e.g. UGA2026"
            />
          </div>
          <div>
            <label className={labelCls}>Description</label>
            <input
              className={inputCls}
              value={codeDraft.description}
              onChange={(e) => setCodeDraft({ ...codeDraft, description: e.target.value })}
              placeholder="e.g. Uganda launch"
            />
          </div>
          <div>
            <label className={labelCls}>Plan</label>
            <select
              className={inputCls}
              value={codeDraft.planCode}
              onChange={(e) => setCodeDraft({ ...codeDraft, planCode: e.target.value as PromotionalPlanCode })}
            >
              {PROMOTIONAL_PLAN_CODES.map((p) => (
                <option key={p} value={p}>
                  {promotionalPlanLabel(p)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Duration days</label>
            <input
              type="number"
              min={1}
              className={inputCls}
              value={codeDraft.durationDays}
              onChange={(e) => setCodeDraft({ ...codeDraft, durationDays: e.target.value })}
            />
          </div>
          <div className="flex items-end">
            <WakaSwitch
              checked={codeDraft.enabled}
              onCheckedChange={(checked) => setCodeDraft({ ...codeDraft, enabled: checked })}
              label="Enabled"
              className="text-sm font-black text-foreground"
            />
          </div>
          <div className="flex items-end gap-2">
            <button
              type="button"
              disabled={savingCode || previewMode}
              onClick={() => void handleSaveCode()}
              className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-waka-600 px-4 text-sm font-black text-white hover:bg-waka-700 disabled:opacity-60"
            >
              {savingCode ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {codeDraft.id ? "Update code" : "Add code"}
            </button>
            {codeDraft.id ? (
              <button
                type="button"
                onClick={() => setCodeDraft(EMPTY_CODE_DRAFT)}
                className="min-h-[44px] rounded-xl bg-muted px-3 text-xs font-black text-muted-foreground hover:bg-muted"
              >
                Cancel
              </button>
            ) : null}
          </div>
        </div>
      </section>

      {/* Metrics */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-black text-foreground">Campaign metrics</h2>
        <div className="mb-3 grid gap-3 sm:grid-cols-3">
          <div>
            <label className={labelCls}>Campaign</label>
            <select
              className={inputCls}
              value={metricsCampaignId}
              onChange={(e) => setMetricsCampaignId(e.target.value)}
            >
              <option value="">All campaigns</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || "(unnamed)"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>From</label>
            <input
              type="datetime-local"
              className={inputCls}
              value={metricsFrom}
              onChange={(e) => setMetricsFrom(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>To</label>
            <input
              type="datetime-local"
              className={inputCls}
              value={metricsTo}
              onChange={(e) => setMetricsTo(e.target.value)}
            />
          </div>
        </div>

        {metricsLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-waka-600" />
          </div>
        ) : metrics ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[
              { label: "Campaign shops", value: metrics.campaignShops.toLocaleString() },
              { label: "Active promotional", value: metrics.activePromotionalShops.toLocaleString() },
              { label: "Expired promotional", value: metrics.expiredPromotionalShops.toLocaleString() },
              { label: "Converted to paid", value: metrics.convertedToPaid.toLocaleString() },
              { label: "Conversion rate", value: `${metrics.conversionRatePct}%` },
              { label: "MRR from converted", value: `UGX ${metrics.mrrFromConvertedUgx.toLocaleString()}` },
            ].map((m) => (
              <div key={m.label} className="rounded-xl border border-border bg-muted px-3 py-3">
                <p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">{m.label}</p>
                <p className="mt-1 text-lg font-black text-foreground">{m.value}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm font-semibold text-muted-foreground">Metrics unavailable.</p>
        )}
      </section>
    </div>
  );
}
